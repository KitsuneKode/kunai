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
import type { MpvRuntimeOptions } from "@/infra/player/mpv-runtime-options";
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

export async function launchMpv(opts: {
  url: string;
  headers: Record<string, string>;
  subtitle: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
  displayTitle: string;
  startAt?: number;
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

  const args = buildMpvArgs(opts, ipcServerCliArg(ipcEndpoint), { mpv: opts.mpv });
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

  let ipcSession: MpvIpcSession | null = null;
  let stopRequested = false;
  let playerReadyNotified = false;
  let playbackStartedNotified = false;
  let currentPositionSeconds = 0;
  let mutableTiming = opts.timing ?? null;
  const watchdog = createPlaybackWatchdog(emitPlaybackEvent);
  const skippedSegments = new Set<string>();
  const skipConfig: PlaybackSkipConfig = {
    skipRecap: opts.autoSkipEnabled !== false && (opts.skipRecap ?? true),
    skipIntro: opts.autoSkipEnabled !== false && (opts.skipIntro ?? true),
    skipPreview: false,
    skipCredits: opts.autoSkipEnabled !== false && (opts.skipCredits ?? true),
    autoNextEnabled: false, // launchMpv is only used for one-shot/manual playback
  };
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
  const trySkipSegment = (automatic: boolean) => {
    const activeSkip = findActivePlaybackSkip(mutableTiming, currentPositionSeconds, skipConfig);
    if (!activeSkip || !ipcSession || skippedSegments.has(activeSkip.key)) {
      return false;
    }
    skippedSegments.add(activeSkip.key);
    void ipcSession.send(["seek", activeSkip.endSeconds, "absolute"]);
    emitPlaybackEvent({ type: "segment-skipped", kind: activeSkip.kind, automatic });
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
          trySkipSegment(true);
        }
      },
      onEndFile: ({ reason, observedAt }) => {
        applyEndFileEvent(telemetry, reason, observedAt);
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
    void attachAdditionalSubtitles(ipcSession, opts.subtitle, opts.subtitleTracks, (trackCount) => {
      emitPlaybackEvent({ type: "subtitle-inventory-ready", trackCount });
      emitPlaybackEvent({ type: "subtitle-attached", trackCount });
    });
  })().catch(() => {});

  const exit = await exitPromise;
  recordPlayerExit(telemetry, exit);

  await ipcBootstrap;

  const flushDeadline = Date.now() + 1_500;
  while (Date.now() < flushDeadline) {
    if (telemetry.latestIpcSample?.endReason) break;
    await Bun.sleep(50);
  }

  await closeIpcSession(ipcSession);
  watchdog.stop();
  emitPlaybackEvent({ type: "player-closed" });
  const socketPathCleanedUp = shouldUnlinkUnixSocket(ipcEndpoint)
    ? await cleanupUnixSocketFile(ipcEndpoint.path)
    : true;

  opts.onControlReady?.(null);

  return finalizePlaybackResult(telemetry, { socketPathCleanedUp });
}

/** True when we should seek / pass --start for a resume position (any positive second). */
export function shouldApplyStartAtSeek(startAt: number | undefined): boolean {
  return typeof startAt === "number" && Number.isFinite(startAt) && startAt > 0;
}

export function buildMpvArgs(
  opts: {
    url: string;
    headers: Record<string, string>;
    subtitle: string | null;
    subtitleTracks?: readonly SubtitleTrack[];
    displayTitle: string;
    startAt?: number;
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
  const args: string[] = [opts.url];

  const referer = opts.headers["referer"] ?? opts.headers["Referer"];
  const userAgent = opts.headers["user-agent"] ?? opts.headers["User-Agent"];
  const origin = opts.headers["origin"] ?? opts.headers["Origin"];
  if (referer) args.push(`--referrer=${referer}`);
  if (userAgent) args.push(`--user-agent=${userAgent}`);
  if (origin) args.push(`--http-header-fields=Origin: ${origin}`);

  if (opts.subtitle) {
    args.push(`--sub-file=${opts.subtitle}`);
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
    // idle=yes + force-window=immediate keep the process and window alive between episodes.
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
  if (config?.scriptOpts) args.push(`--script-opts=${config.scriptOpts}`);

  return args;
}

export function collectAdditionalSubtitleTracks(
  primarySubtitle: string | null,
  subtitleTracks?: readonly SubtitleTrack[],
): SubtitleTrack[] {
  const collected: SubtitleTrack[] = [];
  for (const track of subtitleTracks ?? []) {
    if (
      !track.url ||
      track.url === primarySubtitle ||
      collected.some((item) => item.url === track.url)
    ) {
      continue;
    }
    collected.push(track);
  }
  return collected;
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

async function attachAdditionalSubtitles(
  ipcSession: MpvIpcSession | null,
  primarySubtitle: string | null,
  subtitleTracks?: readonly SubtitleTrack[],
  onAttached?: (trackCount: number) => void,
): Promise<void> {
  if (!ipcSession) return;
  const additionalTracks = collectAdditionalSubtitleTracks(primarySubtitle, subtitleTracks);
  for (const track of additionalTracks) {
    try {
      const result = await ipcSession.send([
        "sub-add",
        track.url,
        "auto",
        track.display ?? "",
        track.language ?? "",
      ]);
      if (!result.ok) return;
    } catch {
      return;
    }
  }
  if (additionalTracks.length > 0 || primarySubtitle) {
    onAttached?.(additionalTracks.length);
  }
}

async function attachLateSubtitles(
  ipcSession: MpvIpcSession | null,
  attachment: LateSubtitleAttachment,
  onAttached?: (trackCount: number) => void,
): Promise<number> {
  if (!ipcSession) return 0;
  let attached = 0;
  if (attachment.primarySubtitle) {
    const result = await ipcSession.send(["sub-add", attachment.primarySubtitle, "select"]);
    if (result.ok) attached += 1;
  }

  for (const track of collectAdditionalSubtitleTracks(
    attachment.primarySubtitle ?? null,
    attachment.subtitleTracks,
  )) {
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
