import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

import type { PlaybackResult } from "@/domain/types";
import type { SubtitleTrack } from "@/domain/types";
import type { MpvIpcSession } from "@/infra/player/mpv-ipc";
import { openMpvIpcSession, waitForMpvIpcEndpoint } from "@/infra/player/mpv-ipc";
import {
  createMpvIpcEndpoint,
  ipcServerCliArg,
  mpvIpcTransportTag,
  newMpvIpcSessionId,
  shouldUnlinkUnixSocket,
} from "@/infra/player/mpv-ipc-endpoint";
import {
  createPlaybackProgressThrottleState,
  shouldEmitPlaybackProgress,
} from "@/infra/player/mpv-playback-kernel";
import { isLocalHlsManifestPlaybackUrl } from "@/infra/player/mpv-playback-url";
import { isAllowedMpvUrl, type MpvUrlKind } from "@/infra/player/mpv-playback-url";
import { registerMpvProcess } from "@/infra/player/mpv-process-registry";
import type { MpvRuntimeOptions } from "@/infra/player/mpv-runtime-options";
import { shouldApplyStartAtSeek } from "@/infra/player/mpv-start-seek";
import { LOCAL_HLS_DEMUXER_LAVF_OPTIONS } from "@/infra/player/mpv-stream-http-headers";
import { normalizeStreamHttpHeaders } from "@/infra/player/mpv-stream-http-headers";
import {
  buildYoutubeMpvScriptOpts,
  isYoutubeWatchUrl,
  joinMpvScriptOpts,
  toYoutubeSubtitlePreferenceTokens,
} from "@kunai/providers/youtube";

export { shouldApplyStartAtSeek };
export { isLocalHlsManifestPlaybackUrl } from "@/infra/player/mpv-playback-url";
export { isAllowedMpvUrl, type MpvUrlKind } from "@/infra/player/mpv-playback-url";
import {
  applyEndFileEvent,
  applyObservedPropertySample,
  createPlayerTelemetryState,
  finalizePlaybackResult,
  noteStreamStall,
  noteTrustedSeek,
  recordPlayerExit,
} from "@/infra/player/mpv-telemetry";
import { findActivePlaybackSkip, type PlaybackSkipConfig } from "@/infra/player/playback-skip";
import { createPlaybackWatchdog } from "@/infra/player/playback-watchdog";
import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import type { LateSubtitleAttachment } from "@/infra/player/PlayerService";
import { dbg } from "@/logger";
import {
  checkStreamPreflight,
  shouldAbortPlaybackForPreflight,
} from "@/services/playback/stream-health-check";
import type { StreamPreflightResult } from "@/services/playback/stream-health-check";
import { normalizeSubtitleUrl } from "@/subtitle";

export async function launchMpv(opts: {
  url: string;
  urlKind?: MpvUrlKind;
  headers: Record<string, string>;
  subtitle: string | null;
  subtitleUrlKind?: MpvUrlKind;
  audioPreference?: string;
  subtitlePreference?: string;
  subtitleTracks?: readonly SubtitleTrack[];
  displayTitle: string;
  startAt?: number;
  requiresYtdl?: boolean;
  ytdlFormat?: string;
  ytdlRawOptions?: string;
  attach?: boolean;
  timing?: import("@/domain/types").PlaybackTimingMetadata | null;
  autoSkipEnabled?: boolean;
  skipRecap?: boolean;
  skipIntro?: boolean;
  skipPreview?: boolean;
  skipCredits?: boolean;
  onControlReady?: (control: ActivePlayerControl | null) => void;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
  mpv?: MpvRuntimeOptions;
}): Promise<PlaybackResult> {
  const sessionId = newMpvIpcSessionId();
  const ipcEndpoint = createMpvIpcEndpoint(sessionId);

  if (shouldUnlinkUnixSocket(ipcEndpoint)) {
    await unlinkIfExists(ipcEndpoint.path);
  }

  const args = buildMpvArgs(opts, ipcServerCliArg(ipcEndpoint), {
    mpv: opts.mpv,
  });
  const telemetry = createPlayerTelemetryState(ipcEndpoint.path);
  noteTrustedSeek(telemetry, opts.startAt ?? 0);
  const baseEmit = opts.onPlaybackEvent ?? (() => {});
  const emitPlaybackEvent = (event: PlayerPlaybackEvent) => {
    if (event.type === "stream-stalled" || event.type === "ipc-stalled") {
      noteStreamStall(telemetry, Date.now());
    }
    baseEmit(event);
  };

  if (!Bun.which("mpv")) {
    throw new Error("mpv is not installed or not found on PATH");
  }

  const stdio = opts.attach ? ("inherit" as const) : ("ignore" as const);
  const mpv = Bun.spawn(["mpv", ...args], {
    stdin: stdio,
    stdout: stdio,
    stderr: stdio,
    env: process.env as Record<string, string>,
  });
  const unregisterMpv = registerMpvProcess(mpv);
  try {
    return await launchMpvInner(
      mpv,
      unregisterMpv,
      opts,
      sessionId,
      ipcEndpoint,
      telemetry,
      emitPlaybackEvent,
    );
  } finally {
    unregisterMpv();
  }
}

async function launchMpvInner(
  mpv: ReturnType<typeof Bun.spawn>,
  _unregisterMpv: () => void,
  opts: Parameters<typeof launchMpv>[0],
  sessionId: string,
  ipcEndpoint: ReturnType<typeof createMpvIpcEndpoint>,
  telemetry: ReturnType<typeof createPlayerTelemetryState>,
  emitPlaybackEvent: (event: PlayerPlaybackEvent) => void,
): Promise<PlaybackResult> {
  let ipcSession: MpvIpcSession | null = null;
  let endFileResolve: ((reason: string | undefined) => void) | null = null;
  const endFileReceived = new Promise<string | undefined>((resolve) => {
    endFileResolve = resolve;
  });
  let stopRequested = false;
  let playerReadyNotified = false;
  let playbackStartedNotified = false;
  let currentPositionSeconds = 0;
  const playbackProgressThrottle = createPlaybackProgressThrottleState();
  let mutableTiming = opts.timing ?? null;
  const watchdog = createPlaybackWatchdog(emitPlaybackEvent);
  const skippedSegments = new Set<string>();
  const buildSkipConfig = (enabled: boolean): PlaybackSkipConfig => ({
    skipRecap: enabled && (opts.skipRecap ?? true),
    skipIntro: enabled && (opts.skipIntro ?? true),
    skipPreview: false,
    skipCredits: enabled && (opts.skipCredits ?? true),
    autoNextEnabled: false, // launchMpv is only used for one-shot/manual playback
  });
  let autoSkipEnabled = opts.autoSkipEnabled !== false;
  let skipConfig = buildSkipConfig(autoSkipEnabled);
  const notifyPlayerReady = () => {
    if (playerReadyNotified) return;
    playerReadyNotified = true;
    emitPlaybackEvent({ type: "player-ready" });
    opts.onPlayerReady?.();
  };
  const notifyPlaybackStarted = () => {
    if (playbackStartedNotified) return;
    playbackStartedNotified = true;
    emitPlaybackEvent({ type: "playback-started" });
  };
  const maybeEmitPlaybackProgress = (observedAt: number) => {
    const sample = telemetry.latestIpcSample;
    if (
      !shouldEmitPlaybackProgress(
        playbackProgressThrottle,
        sample
          ? {
              positionSeconds: sample.positionSeconds,
              durationSeconds: sample.durationSeconds,
            }
          : null,
        observedAt,
      ) ||
      !sample
    ) {
      return;
    }
    emitPlaybackEvent({
      type: "playback-progress",
      positionSeconds: sample.positionSeconds,
      durationSeconds: sample.durationSeconds,
    });
  };
  const trySkipSegment = (automatic: boolean) => {
    const activeSkip = findActivePlaybackSkip(mutableTiming, currentPositionSeconds, skipConfig);
    if (!activeSkip || !ipcSession || skippedSegments.has(activeSkip.key)) {
      return false;
    }
    void ipcSession
      .send(["seek", activeSkip.endSeconds, "absolute"])
      .then((result) => {
        if (result.ok) {
          skippedSegments.add(activeSkip.key);
          emitPlaybackEvent({
            type: "segment-skipped",
            kind: activeSkip.kind,
            automatic,
          });
        }
        return undefined;
      })
      .catch(() => {});
    return true;
  };
  const control: ActivePlayerControl = {
    id: sessionId,
    async stop() {
      if (stopRequested) return;
      stopRequested = true;
      if (ipcSession) {
        const result = await ipcSession.send(["quit"], 1_000);
        if (result.ok) return;
      }
      mpv.kill("SIGTERM");
    },
    async reloadSubtitles() {
      void ipcSession?.send(["sub-reload"]);
    },
    async selectSubtitle(selection) {
      if (!ipcSession) return false;
      if (!selection.subtitleUrl) {
        const result = await ipcSession.send(["set_property", "sid", "no"], 1_000);
        return result.ok;
      }
      const attached = await attachLateSubtitles(
        ipcSession,
        {
          primarySubtitle: selection.subtitleUrl,
          subtitleTracks: selection.subtitleTracks,
        },
        (trackCount) => {
          emitPlaybackEvent({ type: "late-subtitles-attached", trackCount });
        },
      );
      return attached > 0;
    },
    async attachSubtitles(attachment: LateSubtitleAttachment) {
      return await attachLateSubtitles(ipcSession, attachment, (trackCount) => {
        emitPlaybackEvent({ type: "late-subtitles-attached", trackCount });
      });
    },
    async skipCurrentSegment() {
      return trySkipSegment(false);
    },
    updateTiming(timing) {
      mutableTiming = timing;
      trySkipSegment(true);
    },
    updateAutoSkipEnabled(enabled) {
      autoSkipEnabled = enabled;
      skipConfig = buildSkipConfig(autoSkipEnabled);
      trySkipSegment(true);
    },
    getTimingSnapshot() {
      return mutableTiming;
    },
  };
  opts.onControlReady?.(control);
  emitPlaybackEvent({ type: "mpv-process-started" });

  const exitPromise = mpv.exited.then((code) => ({
    code,
    signal: mpv.killed ? ("SIGTERM" as NodeJS.Signals) : null,
  }));

  const preflight = checkStreamPreflight(opts.url, opts.headers, 3_000).then((result) => {
    if (shouldAbortLaunchForDefinitivePreflight(result, ipcSession !== null)) {
      dbg("mpv", "preflight-definitive-failure", {
        reason: result.reason,
        phase: "launch",
        ipcConnected: ipcSession !== null,
      });
      mpv.kill("SIGTERM");
    }
    return result;
  });

  const ipcBootstrap = (async () => {
    const ipcBootstrapStarted = Date.now();
    const ready = await waitForMpvIpcEndpoint(ipcEndpoint, 5_000);
    if (!ready) {
      notifyPlayerReady();
      return;
    }

    ipcSession = await openMpvIpcSession({
      endpoint: ipcEndpoint,
      onPropertyUpdate: ({ name, value, observedAt }) => {
        applyObservedPropertySample(telemetry, { name, value, observedAt });
        if (telemetry.latestIpcSample) {
          watchdog.observe(telemetry.latestIpcSample);
        }
        if ((name === "time-pos" || name === "playback-time") && typeof value === "number") {
          currentPositionSeconds = value;
          if (value > 0) {
            notifyPlaybackStarted();
          }
          maybeEmitPlaybackProgress(observedAt);
          trySkipSegment(true);
        }
      },
      onEndFile: ({ reason, fileError, observedAt }) => {
        applyEndFileEvent(telemetry, reason, observedAt, { fileError });
        endFileResolve?.(reason);
      },
      onCommandResult: (result) => {
        if (!result.ok) {
          emitPlaybackEvent({
            type: "ipc-command-failed",
            command: String(result.command[0] ?? "unknown"),
            error: result.error,
          });
          if (result.error === "timeout") {
            emitPlaybackEvent({
              type: "ipc-stalled",
              command: String(result.command[0] ?? "unknown"),
              error: result.error,
            });
          }
        }
      },
    });

    dbg("mpv-ipc", "ipc-bootstrap-complete", {
      ipcTransport: mpvIpcTransportTag(ipcEndpoint),
      endpoint: ipcServerCliArg(ipcEndpoint),
      bootstrapMs: Date.now() - ipcBootstrapStarted,
      mode: "launchMpv",
    });

    emitPlaybackEvent({ type: "ipc-connected" });
    emitPlaybackEvent({ type: "opening-stream" });
    notifyPlayerReady();
    const trackCount = opts.subtitle ? 1 : 0;
    if (trackCount > 0) {
      emitPlaybackEvent({ type: "subtitle-inventory-ready", trackCount });
      emitPlaybackEvent({ type: "subtitle-attached", trackCount });
    }
  })().catch((err) => {
    dbg("mpv-ipc", "ipc-bootstrap-failed", {
      endpoint: ipcServerCliArg(ipcEndpoint),
      error: String(err),
      mode: "launchMpv",
    });
    emitPlaybackEvent({
      type: "ipc-command-failed",
      command: "bootstrap",
      error: String(err),
    });
  });

  const exit = await exitPromise;
  recordPlayerExit(telemetry, exit);

  // Check if preflight returned a definitive failure before mpv started.
  // This catches dead URLs early so we can skip to fallback without waiting
  // for full mpv startup/shutdown latency.
  const preflightResult = await preflight;
  if (shouldAbortLaunchForDefinitivePreflight(preflightResult, ipcSession !== null)) {
    // Stream is definitively dead and mpv hasn't found it either — abort.
    watchdog.stop();
    const socketPathCleanedUp = await cleanupAbortedMpvLaunch({
      ipcBootstrap,
      getIpcSession: () => ipcSession,
      closeIpcSession,
      cleanupSocket: async () =>
        shouldUnlinkUnixSocket(ipcEndpoint) ? await cleanupUnixSocketFile(ipcEndpoint.path) : true,
    });
    opts.onControlReady?.(null);
    return {
      watchedSeconds: 0,
      duration: 0,
      endReason: "error",
      resultSource: "unknown",
      playerExitedCleanly: false,
      playerExitCode: exit.code,
      playerExitSignal: exit.signal ?? null,
      socketPathCleanedUp,
      lastNonZeroPositionSeconds: 0,
      lastNonZeroDurationSeconds: 0,
      lastTrustedProgressSeconds: 0,
      lastReliableProgressSeconds: 0,
    };
  }

  await ipcBootstrap;

  // Wait for the end-file IPC event (or timeout) before finalizing playback result.
  await Promise.race([endFileReceived, Bun.sleep(1_500).then(() => undefined)]);

  await closeIpcSession(ipcSession);
  watchdog.stop();
  emitPlaybackEvent({ type: "player-closed" });
  const socketPathCleanedUp = shouldUnlinkUnixSocket(ipcEndpoint)
    ? await cleanupUnixSocketFile(ipcEndpoint.path)
    : true;

  opts.onControlReady?.(null);

  return finalizePlaybackResult(telemetry, { socketPathCleanedUp });
}

export function shouldAbortLaunchForDefinitivePreflight(
  result: StreamPreflightResult,
  ipcConnected: boolean,
): result is Extract<StreamPreflightResult, { status: "unreachable" }> {
  return shouldAbortPlaybackForPreflight(result, ipcConnected);
}

export async function cleanupAbortedMpvLaunch(options: {
  ipcBootstrap: Promise<void>;
  getIpcSession: () => MpvIpcSession | null;
  closeIpcSession: (session: MpvIpcSession | null) => Promise<void>;
  cleanupSocket: () => Promise<boolean>;
  bootstrapWaitMs?: number;
  sleep?: (milliseconds: number) => Promise<unknown>;
}): Promise<boolean> {
  const bootstrapCompleted = options.ipcBootstrap.then(
    () => true,
    () => true,
  );
  const completedBeforeDeadline = await Promise.race([
    bootstrapCompleted,
    (options.sleep ?? Bun.sleep)(options.bootstrapWaitMs ?? 2_000).then(() => false),
  ]);

  await options.closeIpcSession(options.getIpcSession());
  const socketPathCleanedUp = await options.cleanupSocket();

  if (!completedBeforeDeadline) {
    // Cleanup-only continuation: reconcile a session that opens after the bounded wait.
    void options.ipcBootstrap
      .then(async () => {
        await options.closeIpcSession(options.getIpcSession());
        await options.cleanupSocket();
        return undefined;
      })
      .catch(() => {});
  }

  return socketPathCleanedUp;
}

export function buildMpvArgs(
  opts: {
    url: string;
    urlKind?: MpvUrlKind;
    headers: Record<string, string>;
    subtitle: string | null;
    subtitleUrlKind?: MpvUrlKind;
    audioPreference?: string;
    subtitlePreference?: string;
    subtitleTracks?: readonly SubtitleTrack[];
    displayTitle: string;
    startAt?: number;
    requiresYtdl?: boolean;
    ytdlFormat?: string;
    ytdlRawOptions?: string;
  },
  ipcPath: string | null,
  config?: {
    persistent?: boolean;
    includeStartArg?: boolean;
    mpv?: MpvRuntimeOptions;
    scriptPath?: string;
    /** Single `--script-opts=` value (comma-separated key=value). */
    scriptOpts?: string;
  },
): string[] {
  if (!isAllowedMpvUrl(opts.url, opts.urlKind ?? "remote")) {
    throw new Error("Refusing to launch mpv with unsafe stream URL scheme");
  }

  const args: string[] = [];

  if (isYoutubeWatchUrl(opts.url) || opts.requiresYtdl) {
    args.push(`--ytdl-format=${opts.ytdlFormat ?? "bv*+ba/b"}`);
    if (opts.ytdlRawOptions?.trim()) {
      args.push(`--ytdl-raw-options=${opts.ytdlRawOptions.trim()}`);
    }
  } else if (opts.url.toLowerCase().includes(".m3u8")) {
    args.push("--ytdl=no");
  }

  const { referer, userAgent, origin } = normalizeStreamHttpHeaders(opts.headers);
  if (referer) args.push(`--referrer=${referer}`);
  if (userAgent) args.push(`--user-agent=${userAgent}`);
  if (origin) args.push(`--http-header-fields=Origin: ${origin}`);

  if (opts.subtitle && isAllowedMpvUrl(opts.subtitle, opts.subtitleUrlKind ?? "remote")) {
    args.push(`--sub-file=${opts.subtitle}`);
  } else if (opts.subtitle) {
    dbg("mpv", "subtitle-target-rejected", { delivery: "launch" });
  }

  const alang = toMpvLanguageToken(opts.audioPreference, {
    forSubtitle: false,
  });
  if (alang) {
    args.push(`--alang=${alang}`);
  }
  const slang = (() => {
    if (isYoutubeWatchUrl(opts.url) || opts.requiresYtdl) {
      return toYoutubeSubtitlePreferenceTokens(opts.subtitlePreference).mpvSlang;
    }
    return toMpvLanguageToken(opts.subtitlePreference, { forSubtitle: true });
  })();
  if (slang) {
    args.push(`--slang=${slang}`);
    if ((isYoutubeWatchUrl(opts.url) || opts.requiresYtdl) && slang !== "no" && slang !== "orig") {
      args.push("--subs-fallback=default");
    }
  }

  const includeStartArg = config?.includeStartArg ?? config?.persistent !== true;
  if (includeStartArg && shouldApplyStartAtSeek(opts.startAt)) {
    args.push(`--start=${opts.startAt}`);
  }
  args.push(`--force-media-title=${opts.displayTitle}`);
  if (config?.persistent) {
    // keep-open=no is intentional: with keep-open=yes, mpv silently pauses at the last
    // frame on natural EOF and never fires the end-file IPC event, so play() hangs and
    // auto-advance is unreachable. keep-open=no fires end-file with reason "eof" reliably.
    // idle=yes keeps the process alive between episodes; force-window=immediate gives
    // instant visual feedback while mpv is still resolving the media.
    args.push("--keep-open=no");
    args.push("--idle=yes");
  } else {
    args.push("--keep-open=no");
    args.push("--idle=no");
  }
  args.push("--force-window=immediate");
  // Kunai resumes via `--start` / IPC when `shouldApplyStartAtSeek(startAt)`. mpv defaults
  // `--resume-playback=yes`, which restores watch-later positions on load — that clashes
  // with explicit episode changes (N / auto-next) and looks like a stale resume offset.
  args.push("--resume-playback=no");
  args.push("--autofit-smaller=1280x720");
  args.push("--autofit-larger=90%x90%");
  args.push("--cache=yes");
  args.push("--cache-pause=yes");
  args.push("--cache-pause-initial=no");
  args.push("--cache-pause-wait=2");
  args.push("--demuxer-readahead-secs=60");
  args.push("--demuxer-max-bytes=200MiB");
  // libavformat HTTP/HLS reconnect hints (backend-dependent). We still rely on IPC
  // watchdogs + refresh/reload; keep-open=always is intentionally not used here because
  // it can suppress end-file and stall autoplay/session hand-off (see keep-open=no above).
  args.push(
    "--demuxer-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=10,reconnect_max_retries=8",
  );
  // Materialized local HLS playlists reference remote HTTPS segments. libavformat defaults
  // to file,crypto,data only for local manifests, which makes every segment fail instantly.
  if (isLocalHlsManifestPlaybackUrl(opts.url)) {
    args.push(`--demuxer-lavf-o=${LOCAL_HLS_DEMUXER_LAVF_OPTIONS}`);
  }
  if (config?.mpv?.clean || config?.mpv?.noUserConfig) {
    args.push("--no-config");
  }
  if (config?.mpv?.debug) {
    args.push("--msg-level=all=v");
    args.push("--term-msg-level=all=v");
  }
  if (config?.mpv?.logFile) {
    args.push(`--log-file=${config.mpv.logFile}`);
  }
  if (ipcPath) args.push(`--input-ipc-server=${ipcPath}`);
  if (config?.scriptPath) args.push(`--script=${config.scriptPath}`);
  if (config?.scriptOpts || isYoutubeWatchUrl(opts.url) || opts.requiresYtdl) {
    const scriptOpts = joinMpvScriptOpts(
      config?.scriptOpts,
      isYoutubeWatchUrl(opts.url) || opts.requiresYtdl ? buildYoutubeMpvScriptOpts() : undefined,
    );
    if (scriptOpts) args.push(`--script-opts=${scriptOpts}`);
  }

  args.push("--", opts.url);

  return args;
}

function toMpvLanguageToken(
  value: string | undefined,
  options: { forSubtitle: boolean },
): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "original") return "orig";
  if (options.forSubtitle && normalized === "none") return "no";
  if (normalized === "interactive" || normalized === "fzf") return null;
  return normalized;
}

export function collectAdditionalSubtitleTracks(
  primarySubtitle: string | null,
  subtitleTracks?: readonly SubtitleTrack[],
): SubtitleTrack[] {
  const collected: SubtitleTrack[] = [];
  const seen = new Set<string>();
  if (primarySubtitle) {
    seen.add(normalizeSubtitleUrl(primarySubtitle));
  }
  for (const track of subtitleTracks ?? []) {
    const key = normalizeSubtitleUrl(track.url);
    if (!track.url || seen.has(key)) {
      continue;
    }
    seen.add(key);
    collected.push(track);
  }
  return collected;
}

export function collectLaunchSubtitleFiles(
  primarySubtitle: string | null,
  subtitleTracks?: readonly SubtitleTrack[],
): string[] {
  const files: string[] = [];
  if (primarySubtitle) {
    files.push(primarySubtitle);
  }
  for (const track of collectAdditionalSubtitleTracks(primarySubtitle, subtitleTracks)) {
    files.push(track.url);
  }
  return files;
}

export function describeSubtitleTrackForMpv(
  url: string,
  subtitleTracks?: readonly SubtitleTrack[],
): { title: string; language: string } {
  const key = normalizeSubtitleUrl(url);
  const match = subtitleTracks?.find((track) => normalizeSubtitleUrl(track.url) === key);
  const language = match?.language?.trim() ?? "";
  const title =
    match?.display?.trim() ||
    [language || null, match?.sourceName?.trim() || null, match?.sourceKind || null]
      .filter((part): part is string => Boolean(part))
      .join(" ");
  return { title, language };
}

async function unlinkIfExists(path: string): Promise<void> {
  if (!existsSync(path)) return;
  await unlink(path).catch(() => {});
}

async function cleanupUnixSocketFile(socketPath: string): Promise<boolean> {
  if (!existsSync(socketPath)) return true;
  try {
    await unlink(socketPath);
    return true;
  } catch {
    return false;
  }
}

async function closeIpcSession(ipcSession: MpvIpcSession | null): Promise<void> {
  if (ipcSession === null) return;
  await ipcSession.close().catch(() => {});
}

export async function attachLateSubtitles(
  ipcSession: MpvIpcSession | null,
  attachment: LateSubtitleAttachment,
  onAttached?: (trackCount: number) => void,
): Promise<number> {
  if (!ipcSession) return 0;
  let attached = 0;
  const primarySubtitle =
    attachment.primarySubtitle && isAllowedMpvUrl(attachment.primarySubtitle, "remote")
      ? attachment.primarySubtitle
      : null;
  if (attachment.primarySubtitle && !primarySubtitle) {
    dbg("mpv", "subtitle-target-rejected", { delivery: "late-primary" });
  }
  if (primarySubtitle) {
    const primary = describeSubtitleTrackForMpv(primarySubtitle, attachment.subtitleTracks);
    const result = await ipcSession.send([
      "sub-add",
      primarySubtitle,
      "select",
      primary.title,
      primary.language,
    ]);
    if (result.ok) attached += 1;
  }

  for (const track of collectAdditionalSubtitleTracks(primarySubtitle, attachment.subtitleTracks)) {
    if (!isAllowedMpvUrl(track.url, "remote")) {
      dbg("mpv", "subtitle-target-rejected", { delivery: "late-additional" });
      continue;
    }
    const result = await ipcSession.send([
      "sub-add",
      track.url,
      "auto",
      track.display ?? "",
      track.language ?? "",
    ]);
    if (result.ok) attached += 1;
  }

  if (attached > 0) onAttached?.(attached);
  return attached;
}
