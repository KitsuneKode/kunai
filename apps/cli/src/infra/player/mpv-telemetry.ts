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
}

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
  };
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
) {
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
    case "demuxer-cache-state":
      next.demuxerCacheState = update.value;
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

  if (isMeaningful(next)) {
    state.lastNonZeroSample = preferStrongerProgressSample(state.lastNonZeroSample, next);
  }

  state.latestIpcSample = next;
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
  state.endReason = mapped;

  const base = state.latestIpcSample ?? state.lastNonZeroSample;
  if (!base) return;

  const finalSample: PlayerTelemetrySample = {
    ...base,
    source: "ipc",
    observedAt,
    endReason: mapped,
  };

  if (mapped === "eof" && finalSample.durationSeconds > 0) {
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

  if (state.endReason === "unknown" && state.latestIpcSample?.eofReached) {
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

  if (endReason === "eof" && duration > 0) {
    watchedSeconds = Math.max(watchedSeconds, duration);
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
  };
}
