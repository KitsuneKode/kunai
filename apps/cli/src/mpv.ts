import { spawn } from "child_process";
import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import type { PlaybackResult } from "@/domain/types";
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
  subtitleUrls?: readonly string[];
  displayTitle: string;
  startAt?: number;
  attach?: boolean;
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

  let ipcSession: MpvIpcSession | null = null;
  const ipcBootstrap = (async () => {
    if (!ipcPath) return;
    const ready = await waitForMpvIpcSocket(ipcPath, 5_000);
    if (!ready) return;

    ipcSession = await openMpvIpcSession({
      socketPath: ipcPath,
      onPropertyUpdate: ({ name, value, observedAt }) => {
        applyObservedPropertySample(telemetry, { name, value, observedAt });
      },
      onEndFile: ({ reason, observedAt }) => {
        applyEndFileEvent(telemetry, reason, observedAt);
      },
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
  const socketPathCleanedUp = ipcPath ? await cleanupSocket(ipcPath) : true;

  return finalizePlaybackResult(telemetry, { socketPathCleanedUp });
}

function buildMpvArgs(
  opts: {
    url: string;
    headers: Record<string, string>;
    subtitle: string | null;
    subtitleUrls?: readonly string[];
    displayTitle: string;
    startAt?: number;
  },
  ipcPath: string | null,
): string[] {
  const args: string[] = [opts.url];

  const referer = opts.headers["referer"] ?? opts.headers["Referer"];
  const userAgent = opts.headers["user-agent"] ?? opts.headers["User-Agent"];
  const origin = opts.headers["origin"] ?? opts.headers["Origin"];
  if (referer) args.push(`--referrer=${referer}`);
  if (userAgent) args.push(`--user-agent=${userAgent}`);
  if (origin) args.push(`--http-header-fields=Origin: ${origin}`);

  const subtitleUrls: string[] = [];
  if (opts.subtitle) subtitleUrls.push(opts.subtitle);
  for (const url of opts.subtitleUrls ?? []) {
    if (!subtitleUrls.includes(url)) subtitleUrls.push(url);
  }
  for (const url of subtitleUrls) {
    args.push(`--sub-file=${url}`);
  }

  if (opts.startAt && opts.startAt > 5) args.push(`--start=${opts.startAt}`);
  args.push(`--force-media-title=${opts.displayTitle}`);
  if (ipcPath) args.push(`--input-ipc-server=${ipcPath}`);

  return args;
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
