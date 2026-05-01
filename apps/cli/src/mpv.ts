import { spawn } from "child_process";
import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import type { PlaybackResult } from "@/domain/types";
import type { SubtitleTrack } from "@/domain/types";
import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import type { MpvIpcSession } from "@/infra/player/mpv-ipc";
import {
  applyEndFileEvent,
  applyObservedPropertySample,
  createPlayerTelemetryState,
  finalizePlaybackResult,
  recordPlayerExit,
} from "@/infra/player/mpv-telemetry";
import { openMpvIpcSession, waitForMpvIpcSocket } from "@/infra/player/mpv-ipc";

export async function launchMpv(opts: {
  url: string;
  headers: Record<string, string>;
  subtitle: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
  displayTitle: string;
  startAt?: number;
  attach?: boolean;
  onControlReady?: (control: ActivePlayerControl | null) => void;
  onPlayerReady?: () => void;
}): Promise<PlaybackResult> {
  const nonce = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ipcPath = process.platform === "win32" ? null : join(tmpdir(), `kunai-mpv-${nonce}.sock`);

  if (ipcPath) {
    await unlinkIfExists(ipcPath);
  }

  const args = buildMpvArgs(opts, ipcPath);
  const telemetry = createPlayerTelemetryState(ipcPath ?? undefined);

  const mpv = spawn("mpv", args, {
    detached: !opts.attach,
    stdio: opts.attach ? "inherit" : ["ignore", "ignore", "ignore"],
    env: process.env as Record<string, string>,
  });

  let ipcSession: MpvIpcSession | null = null;
  let stopRequested = false;
  let playerReadyNotified = false;
  const notifyPlayerReady = () => {
    if (playerReadyNotified) return;
    playerReadyNotified = true;
    opts.onPlayerReady?.();
  };
  const control: ActivePlayerControl = {
    id: nonce,
    async stop() {
      if (stopRequested) return;
      stopRequested = true;
      if (ipcSession) {
        ipcSession.send(["quit"]);
        return;
      }
      mpv.kill("SIGTERM");
    },
    async reloadSubtitles() {
      ipcSession?.send(["sub-reload"]);
    },
  };
  opts.onControlReady?.(control);

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
      },
      onEndFile: ({ reason, observedAt }) => {
        applyEndFileEvent(telemetry, reason, observedAt);
      },
    });

    notifyPlayerReady();
    void attachAdditionalSubtitles(ipcSession, opts.subtitle, opts.subtitleTracks);
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
  config?: { persistent?: boolean },
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

  if (opts.startAt && opts.startAt > 5) args.push(`--start=${opts.startAt}`);
  args.push(`--force-media-title=${opts.displayTitle}`);
  if (config?.persistent) {
    args.push("--keep-open=yes");
    args.push("--idle=yes");
  } else {
    args.push("--keep-open=no");
    args.push("--idle=no");
  }
  args.push("--force-window=no");
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
): Promise<void> {
  if (!ipcSession) return;
  for (const track of collectAdditionalSubtitleTracks(primarySubtitle, subtitleTracks)) {
    try {
      ipcSession.send(["sub-add", track.url, "auto", track.display ?? "", track.language ?? ""]);
    } catch {
      return;
    }
  }
}
