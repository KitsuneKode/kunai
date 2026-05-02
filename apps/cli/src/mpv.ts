import { spawn } from "child_process";
import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import type { PlaybackResult } from "@/domain/types";
import type { SubtitleTrack } from "@/domain/types";
import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import type { LateSubtitleAttachment } from "@/infra/player/PlayerService";
import type { MpvRuntimeOptions } from "@/infra/player/mpv-runtime-options";
import type { MpvIpcSession } from "@/infra/player/mpv-ipc";
import {
  applyEndFileEvent,
  applyObservedPropertySample,
  createPlayerTelemetryState,
  finalizePlaybackResult,
  recordPlayerExit,
} from "@/infra/player/mpv-telemetry";
import { openMpvIpcSession, waitForMpvIpcSocket } from "@/infra/player/mpv-ipc";
import { findActivePlaybackSkip, type PlaybackSkipConfig } from "@/infra/player/playback-skip";
import { createPlaybackWatchdog } from "@/infra/player/playback-watchdog";

export async function launchMpv(opts: {
  url: string;
  headers: Record<string, string>;
  subtitle: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
  displayTitle: string;
  startAt?: number;
  attach?: boolean;
  timing?: import("@/domain/types").PlaybackTimingMetadata | null;
  skipRecap?: boolean;
  skipIntro?: boolean;
  skipPreview?: boolean;
  onControlReady?: (control: ActivePlayerControl | null) => void;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
  mpv?: MpvRuntimeOptions;
}): Promise<PlaybackResult> {
  const nonce = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ipcPath = process.platform === "win32" ? null : join(tmpdir(), `kunai-mpv-${nonce}.sock`);

  if (ipcPath) {
    await unlinkIfExists(ipcPath);
  }

  const args = buildMpvArgs(opts, ipcPath, { mpv: opts.mpv });
  const telemetry = createPlayerTelemetryState(ipcPath ?? undefined);
  const emitPlaybackEvent = opts.onPlaybackEvent ?? (() => {});

  const mpv = spawn("mpv", args, {
    detached: false,
    stdio: opts.attach ? "inherit" : ["ignore", "ignore", "ignore"],
    env: process.env as Record<string, string>,
  });

  let ipcSession: MpvIpcSession | null = null;
  let stopRequested = false;
  let playerReadyNotified = false;
  let playbackStartedNotified = false;
  let currentPositionSeconds = 0;
  const watchdog = createPlaybackWatchdog(emitPlaybackEvent);
  const skippedSegments = new Set<string>();
  const skipConfig: PlaybackSkipConfig = {
    skipRecap: opts.skipRecap ?? true,
    skipIntro: opts.skipIntro ?? true,
    skipPreview: opts.skipPreview ?? true,
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
    const activeSkip = findActivePlaybackSkip(opts.timing, currentPositionSeconds, skipConfig);
    if (!activeSkip || !ipcSession || skippedSegments.has(activeSkip.key)) {
      return false;
    }
    skippedSegments.add(activeSkip.key);
    void ipcSession.send(["seek", activeSkip.endSeconds, "absolute"]);
    emitPlaybackEvent({ type: "segment-skipped", kind: activeSkip.kind, automatic });
    return true;
  };
  const control: ActivePlayerControl = {
    id: nonce,
    async stop() {
      if (stopRequested) return;
      stopRequested = true;
      if (ipcSession) {
        await ipcSession.send(["quit"], 1_000);
        return;
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
  };
  opts.onControlReady?.(control);
  emitPlaybackEvent({ type: "mpv-process-started" });

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      let settled = false;
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        resolve({ code, signal });
      };

      mpv.once("close", (code, signal) => finish(code, signal));
      mpv.once("error", (error) => {
        console.error(`\n[!] mpv: ${error.message}`);
        finish(1, null);
      });
    },
  );

  const ipcBootstrap = (async () => {
    if (!ipcPath) return;
    const ready = await waitForMpvIpcSocket(ipcPath, 5_000);
    if (!ready) {
      notifyPlayerReady();
      return;
    }

    ipcSession = await openMpvIpcSession({
      socketPath: ipcPath,
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
    if (telemetry.latestIpcSample?.endReason || telemetry.lastNonZeroSample) {
      break;
    }
    await Bun.sleep(50);
  }

  await closeIpcSession(ipcSession);
  watchdog.stop();
  emitPlaybackEvent({ type: "player-closed" });
  const socketPathCleanedUp = ipcPath ? await cleanupSocket(ipcPath) : true;

  opts.onControlReady?.(null);

  return finalizePlaybackResult(telemetry, { socketPathCleanedUp });
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
  config?: { persistent?: boolean; includeStartArg?: boolean; mpv?: MpvRuntimeOptions },
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

  if ((config?.includeStartArg ?? true) && opts.startAt && opts.startAt > 5) {
    args.push(`--start=${opts.startAt}`);
  }
  args.push(`--force-media-title=${opts.displayTitle}`);
  if (config?.persistent) {
    args.push("--keep-open=yes");
    args.push("--idle=yes");
  } else {
    args.push("--keep-open=no");
    args.push("--idle=no");
  }
  args.push("--force-window=immediate");
  args.push("--autofit-larger=90%x90%");
  args.push("--cache=yes");
  args.push("--cache-pause=yes");
  args.push("--cache-pause-wait=2");
  args.push("--demuxer-readahead-secs=20");
  args.push("--demuxer-max-bytes=128MiB");
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

async function cleanupSocket(ipcPath: string): Promise<boolean> {
  if (!existsSync(ipcPath)) return true;
  try {
    await unlink(ipcPath);
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
