import type { EndReason, PlaybackResult } from "@/domain/types";

export interface PlayerTelemetrySample {
  source: "ipc";
  observedAt: number;
  positionSeconds: number;
  durationSeconds: number;
  percentPos?: number;
  paused?: boolean;
  seeking?: boolean;
  pausedForCache?: boolean;
  cacheBufferingState?: number;
  demuxerCacheDurationSeconds?: number;
  demuxerCacheState?: unknown;
  /** From demuxer-cache-state when mpv exposes it. */
  demuxerCacheUnderrun?: boolean;
  /** From demuxer-cache-state `raw-input-rate` when mpv exposes it. */
  demuxerRawInputRate?: number;
  /** True when the demuxer is reading over the network (HTTP/HLS, etc.). */
  demuxerViaNetwork?: boolean;
  cacheSpeedBytesPerSecond?: number;
  voConfigured?: boolean;
  eofReached?: boolean;
  idleActive?: boolean;
  coreIdle?: boolean;
  filename?: string;
  mediaTitle?: string;
  trackList?: unknown;
  endReason?: EndReason;
}

export interface PlayerTelemetryState {
  readonly socketPath?: string;
  latestIpcSample: PlayerTelemetrySample | null;
  lastNonZeroSample: PlayerTelemetrySample | null;
  endReason: EndReason;
  playerExitedCleanly: boolean;
  playerExitCode: number | null;
  playerExitSignal: NodeJS.Signals | null;
  /**
   * Highest time-pos reached via small forward steps (avoids treating a demuxer
   * jump straight to EOF duration as genuine watch progress).
   */
  maxTrustedProgressSeconds: number;
  /**
   * Most recent position reached through natural playback or user-initiated seek.
   * Updated on small forward steps AND user seeks (both forward and backward).
   * Unlike maxTrustedProgressSeconds, this CAN go down when the user seeks backward.
   */
  lastReliableProgressSeconds: number;
  /** After the first positive time sample, large opening seeks (resume) are allowed once. */
  trustedProgressBootstrapDone: boolean;
  /** Last `stream-stalled` / `ipc-stalled` observation (ms) for premature-EOF heuristics. */
  lastStreamStallAtMs: number | null;
  /** Pause timing, used to distinguish dropped network streams from genuine EOF after long pauses. */
  lastPausedAtMs: number | null;
  lastUnpausedAtMs: number | null;
  /** True when eof was demoted to unknown because progress looked inconsistent with a full watch. */
  eofDemotedByPrematureGuard: boolean;
}

type ObservedPropertySampleOptions = {
  readonly acceptPlaybackProperties?: boolean;
};

type CleanupStatus = {
  socketPathCleanedUp: boolean;
};

function normalizeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 0 ? 0 : value;
  }

  return 0;
}

function isMeaningful(sample: Pick<PlayerTelemetrySample, "positionSeconds" | "durationSeconds">) {
  return sample.positionSeconds > 0 || sample.durationSeconds > 0;
}

function preferStrongerProgressSample(
  existing: PlayerTelemetrySample | null,
  candidate: PlayerTelemetrySample,
): PlayerTelemetrySample {
  if (!existing) return candidate;

  if (candidate.positionSeconds > existing.positionSeconds) return candidate;
  if (candidate.positionSeconds < existing.positionSeconds) return existing;
  if (candidate.durationSeconds > existing.durationSeconds) return candidate;
  if (candidate.durationSeconds < existing.durationSeconds) return existing;
  if (!isMeaningful(existing) && isMeaningful(candidate)) return candidate;
  if (candidate.observedAt >= existing.observedAt) return candidate;
  return existing;
}

export function createPlayerTelemetryState(socketPath?: string): PlayerTelemetryState {
  return {
    socketPath,
    latestIpcSample: null,
    lastNonZeroSample: null,
    endReason: "unknown",
    playerExitedCleanly: false,
    playerExitCode: null,
    playerExitSignal: null,
    maxTrustedProgressSeconds: 0,
    lastReliableProgressSeconds: 0,
    trustedProgressBootstrapDone: false,
    lastStreamStallAtMs: null,
    lastPausedAtMs: null,
    lastUnpausedAtMs: null,
    eofDemotedByPrematureGuard: false,
  };
}

const TRUSTED_FORWARD_JUMP_SEC = 55;
const SUSPICIOUS_FIRST_SAMPLE_MIN_DURATION_SEC = 300;
const SUSPICIOUS_FIRST_SAMPLE_END_FRACTION = 0.95;

/** Called when the playback watchdog reports stream/ipc stall (correlate with spurious EOF). */
export function noteStreamStall(state: PlayerTelemetryState, observedAtMs: number): void {
  const pos = state.latestIpcSample?.positionSeconds ?? 0;
  state.lastStreamStallAtMs = observedAtMs;
  if (pos > 0) {
    state.maxTrustedProgressSeconds = Math.max(state.maxTrustedProgressSeconds, pos);
  }
}

function advanceTrustedProgressSeconds(
  state: PlayerTelemetryState,
  prevPositionSeconds: number,
  newPositionSeconds: number,
  durationSeconds: number,
  wasSeeking: boolean,
): void {
  if (wasSeeking) {
    state.maxTrustedProgressSeconds = Math.max(state.maxTrustedProgressSeconds, newPositionSeconds);
    state.lastReliableProgressSeconds = newPositionSeconds;
    state.trustedProgressBootstrapDone = true;
    return;
  }

  if (newPositionSeconds <= state.maxTrustedProgressSeconds) return;

  if (!state.trustedProgressBootstrapDone && prevPositionSeconds === 0 && newPositionSeconds > 0) {
    if (
      durationSeconds >= SUSPICIOUS_FIRST_SAMPLE_MIN_DURATION_SEC &&
      newPositionSeconds >= durationSeconds * SUSPICIOUS_FIRST_SAMPLE_END_FRACTION
    ) {
      return;
    }
    state.maxTrustedProgressSeconds = newPositionSeconds;
    state.lastReliableProgressSeconds = newPositionSeconds;
    state.trustedProgressBootstrapDone = true;
    return;
  }

  if (!state.trustedProgressBootstrapDone && newPositionSeconds > 0) {
    state.trustedProgressBootstrapDone = true;
  }

  const delta = newPositionSeconds - prevPositionSeconds;
  if (delta <= TRUSTED_FORWARD_JUMP_SEC) {
    state.maxTrustedProgressSeconds = newPositionSeconds;
    state.lastReliableProgressSeconds = newPositionSeconds;
  }
}

export function noteTrustedSeek(state: PlayerTelemetryState, positionSeconds: number): void {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) return;
  state.maxTrustedProgressSeconds = Math.max(state.maxTrustedProgressSeconds, positionSeconds);
  state.lastReliableProgressSeconds = Math.max(state.lastReliableProgressSeconds, positionSeconds);
  state.trustedProgressBootstrapDone = true;
}

function parseDemuxerCacheDiagnostics(value: unknown): {
  underrun: boolean;
  rawInputRate: number | undefined;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { underrun: false, rawInputRate: undefined };
  }
  const v = value as Record<string, unknown>;
  const underrun = v.underrun === true;
  const raw = v["raw-input-rate"];
  const rawInputRate = typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  return { underrun, rawInputRate };
}

function shouldDemotePrematureEof(
  state: PlayerTelemetryState,
  durationSeconds: number,
  maxTrusted: number,
  observedAtMs: number,
  demuxerViaNetwork: boolean | undefined,
): boolean {
  if (durationSeconds <= 180) return false;

  /** If trusted progress is within this window of the reported duration, trust EOF. */
  const tail = Math.max(240, Math.min(1200, durationSeconds * 0.35));
  if (maxTrusted >= durationSeconds - tail) return false;

  const stallAt = state.lastStreamStallAtMs;
  if (stallAt !== null && observedAtMs - stallAt <= 180_000) {
    return true;
  }

  const earlyCap = Math.min(durationSeconds * 0.35, 420);
  if (durationSeconds > 600 && maxTrusted <= earlyCap) {
    return true;
  }

  // Network stream ended as "eof" but trusted playback never reached most of the
  // reported duration — typical of a dropped socket / demuxer EOF on HLS/VOD.
  if (
    demuxerViaNetwork === true &&
    durationSeconds >= 300 &&
    maxTrusted >= 60 &&
    maxTrusted + Math.min(180, durationSeconds * 0.08) < durationSeconds * 0.72
  ) {
    return true;
  }

  return false;
}

function shouldDemotePauseDroppedEof(
  state: PlayerTelemetryState,
  sample: PlayerTelemetrySample | null | undefined,
  durationSeconds: number,
  maxTrusted: number,
  observedAtMs: number,
): boolean {
  if (durationSeconds <= 180) return false;
  if (sample?.eofReached === true) return false;
  if (maxTrusted >= durationSeconds - 5) return false;

  const pausedNow = sample?.paused === true;
  const pausedAt = state.lastPausedAtMs;
  const unpausedAt = state.lastUnpausedAtMs;
  const stillPaused = pausedAt !== null && (unpausedAt === null || unpausedAt < pausedAt);
  const justResumed = unpausedAt !== null && observedAtMs - unpausedAt <= 30_000;

  return pausedNow || stillPaused || justResumed;
}

export function mapMpvEndReason(reason: string | null | undefined): EndReason {
  switch ((reason ?? "").trim()) {
    case "eof":
      return "eof";
    case "quit":
    case "stop":
      return "quit";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

export function applyObservedPropertySample(
  state: PlayerTelemetryState,
  update: {
    name: string;
    value: unknown;
    observedAt?: number;
  },
  options: ObservedPropertySampleOptions = {},
) {
  if (options.acceptPlaybackProperties === false && isPlaybackProgressProperty(update.name)) {
    return;
  }

  const observedAt = update.observedAt ?? Date.now();
  const base = state.latestIpcSample ?? {
    source: "ipc" as const,
    observedAt,
    positionSeconds: 0,
    durationSeconds: 0,
  };

  const next: PlayerTelemetrySample = {
    ...base,
    source: "ipc",
    observedAt,
  };

  switch (update.name) {
    case "time-pos":
    case "playback-time":
      next.positionSeconds = normalizeNumber(update.value);
      break;
    case "duration":
      next.durationSeconds = normalizeNumber(update.value);
      break;
    case "percent-pos":
      if (typeof update.value === "number" && Number.isFinite(update.value)) {
        next.percentPos = update.value;
      }
      break;
    case "pause":
      next.paused = Boolean(update.value);
      if (next.paused) {
        state.lastPausedAtMs = observedAt;
      } else {
        state.lastUnpausedAtMs = observedAt;
      }
      break;
    case "seeking":
      next.seeking = Boolean(update.value);
      break;
    case "paused-for-cache":
      next.pausedForCache = Boolean(update.value);
      break;
    case "cache-buffering-state":
      if (typeof update.value === "number" && Number.isFinite(update.value)) {
        next.cacheBufferingState = update.value;
      }
      break;
    case "demuxer-cache-duration":
      next.demuxerCacheDurationSeconds = normalizeNumber(update.value);
      break;
    case "demuxer-cache-state": {
      const parsed = parseDemuxerCacheDiagnostics(update.value);
      next.demuxerCacheState = update.value;
      next.demuxerCacheUnderrun = parsed.underrun;
      next.demuxerRawInputRate = parsed.rawInputRate;
      break;
    }
    case "demuxer-via-network":
      next.demuxerViaNetwork = Boolean(update.value);
      break;
    case "cache-speed":
      if (typeof update.value === "number" && Number.isFinite(update.value)) {
        next.cacheSpeedBytesPerSecond = update.value;
      }
      break;
    case "vo-configured":
      next.voConfigured = Boolean(update.value);
      break;
    case "eof-reached":
      next.eofReached = Boolean(update.value);
      break;
    case "idle-active":
      next.idleActive = Boolean(update.value);
      break;
    case "core-idle":
      next.coreIdle = Boolean(update.value);
      break;
    case "filename":
      if (typeof update.value === "string") next.filename = update.value;
      break;
    case "media-title":
      if (typeof update.value === "string") next.mediaTitle = update.value;
      break;
    case "track-list":
      next.trackList = update.value;
      break;
    default:
      return;
  }

  if (update.name === "time-pos" || update.name === "playback-time") {
    advanceTrustedProgressSeconds(
      state,
      base.positionSeconds,
      next.positionSeconds,
      next.durationSeconds,
      base.seeking === true,
    );
  }

  if (isMeaningful(next)) {
    state.lastNonZeroSample = preferStrongerProgressSample(state.lastNonZeroSample, next);
  }

  state.latestIpcSample = next;
}

function isPlaybackProgressProperty(name: string): boolean {
  switch (name) {
    case "time-pos":
    case "playback-time":
    case "duration":
    case "percent-pos":
    case "seeking":
    case "paused-for-cache":
    case "cache-buffering-state":
    case "demuxer-cache-duration":
    case "demuxer-cache-state":
    case "demuxer-via-network":
    case "cache-speed":
    case "vo-configured":
    case "eof-reached":
    case "idle-active":
    case "core-idle":
    case "filename":
    case "media-title":
    case "track-list":
      return true;
    default:
      return false;
  }
}

export function applyEndFileEvent(
  state: PlayerTelemetryState,
  reason: string | null | undefined,
  observedAt = Date.now(),
) {
  let mapped = mapMpvEndReason(reason);
  // With --keep-open=yes some mpv builds emit end-file without a clear eof reason.
  // Promote to "eof" when eof-reached was previously observed so autoplay isn't
  // incorrectly blocked by an ambiguous reason string.
  if (
    mapped === "unknown" &&
    (state.latestIpcSample?.eofReached || state.lastNonZeroSample?.eofReached)
  ) {
    mapped = "eof";
  }

  const base = state.latestIpcSample ?? state.lastNonZeroSample;
  const durationForGuard = base?.durationSeconds ?? 0;
  let demotedPrematureEof = false;
  if (mapped === "eof" && durationForGuard > 0) {
    if (
      shouldDemotePrematureEof(
        state,
        durationForGuard,
        state.maxTrustedProgressSeconds,
        observedAt,
        base?.demuxerViaNetwork,
      )
    ) {
      mapped = "unknown";
      demotedPrematureEof = true;
      state.eofDemotedByPrematureGuard = true;
    }
    if (
      !demotedPrematureEof &&
      shouldDemotePauseDroppedEof(
        state,
        base,
        durationForGuard,
        state.maxTrustedProgressSeconds,
        observedAt,
      )
    ) {
      mapped = "unknown";
      demotedPrematureEof = true;
      state.eofDemotedByPrematureGuard = true;
    }
  }

  state.endReason = mapped;

  if (!base) return;

  const finalSample: PlayerTelemetrySample = {
    ...base,
    source: "ipc",
    observedAt,
    endReason: mapped,
  };

  if (demotedPrematureEof) {
    const capped = Math.min(
      Math.max(0, state.maxTrustedProgressSeconds),
      finalSample.durationSeconds > 0
        ? Math.max(0, finalSample.durationSeconds - 1)
        : state.maxTrustedProgressSeconds,
    );
    finalSample.positionSeconds = capped;
    finalSample.eofReached = false;
  } else if (mapped === "eof" && finalSample.durationSeconds > 0) {
    finalSample.positionSeconds = Math.max(
      finalSample.positionSeconds,
      finalSample.durationSeconds,
    );
  }

  state.latestIpcSample = finalSample;
  if (isMeaningful(finalSample)) {
    state.lastNonZeroSample = preferStrongerProgressSample(state.lastNonZeroSample, finalSample);
  }
}

export function recordPlayerExit(
  state: PlayerTelemetryState,
  exit: {
    code: number | null;
    signal: NodeJS.Signals | null;
  },
) {
  state.playerExitCode = exit.code;
  state.playerExitSignal = exit.signal;
  state.playerExitedCleanly = exit.code === 0 && exit.signal === null;

  if (
    state.endReason === "unknown" &&
    state.latestIpcSample?.eofReached &&
    !state.eofDemotedByPrematureGuard
  ) {
    state.endReason = "eof";
  } else if (state.endReason === "unknown") {
    if (exit.code !== null && exit.code !== 0) {
      state.endReason = "error";
    } else if (exit.signal) {
      state.endReason = "quit";
    } else if (exit.code === 0) {
      state.endReason = "quit";
    }
  }
}

export function finalizePlaybackResult(
  state: PlayerTelemetryState,
  cleanup: CleanupStatus,
): PlaybackResult {
  const chosen =
    state.latestIpcSample && isMeaningful(state.latestIpcSample)
      ? state.latestIpcSample
      : state.lastNonZeroSample;

  const endReason = chosen?.endReason ?? state.endReason;
  let watchedSeconds = chosen?.positionSeconds ?? 0;
  const duration = chosen?.durationSeconds ?? 0;
  const lastTrustedProgressSeconds = state.maxTrustedProgressSeconds;

  if (endReason === "eof" && duration > 0) {
    watchedSeconds = Math.max(watchedSeconds, duration);
  }

  const lastNonZeroPos = state.lastNonZeroSample?.positionSeconds ?? 0;
  if (
    watchedSeconds <= 0 &&
    lastNonZeroPos > 0 &&
    !(state.eofDemotedByPrematureGuard && lastTrustedProgressSeconds <= 0) &&
    (endReason === "quit" || endReason === "error" || endReason === "unknown")
  ) {
    watchedSeconds = lastNonZeroPos;
  }

  if (
    watchedSeconds <= 0 &&
    duration <= 0 &&
    state.playerExitCode !== null &&
    state.playerExitCode !== 0
  ) {
    return {
      watchedSeconds: 0,
      duration: 0,
      endReason: "error",
      resultSource: "unknown",
      playerExitedCleanly: state.playerExitedCleanly,
      playerExitCode: state.playerExitCode,
      playerExitSignal: state.playerExitSignal ?? null,
      socketPathCleanedUp: cleanup.socketPathCleanedUp,
      lastNonZeroPositionSeconds: 0,
      lastNonZeroDurationSeconds: 0,
      lastTrustedProgressSeconds: 0,
      lastReliableProgressSeconds: 0,
      ...(state.eofDemotedByPrematureGuard ? { suspectedDeadStream: true } : {}),
    };
  }

  return {
    watchedSeconds,
    duration,
    endReason,
    resultSource: chosen ? "ipc" : "unknown",
    playerExitedCleanly: state.playerExitedCleanly,
    playerExitCode: state.playerExitCode,
    playerExitSignal: state.playerExitSignal ?? null,
    socketPathCleanedUp: cleanup.socketPathCleanedUp,
    lastNonZeroPositionSeconds: state.lastNonZeroSample?.positionSeconds ?? 0,
    lastNonZeroDurationSeconds: state.lastNonZeroSample?.durationSeconds ?? 0,
    lastTrustedProgressSeconds,
    lastReliableProgressSeconds: state.lastReliableProgressSeconds,
    ...(state.eofDemotedByPrematureGuard ? { suspectedDeadStream: true } : {}),
  };
}
