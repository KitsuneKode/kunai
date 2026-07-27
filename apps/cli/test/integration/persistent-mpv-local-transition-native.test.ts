import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundledKunaiMpvBridgePath } from "@/infra/player/kunai-mpv-bridge";
import type { PersistentMpvSessionRuntime } from "@/infra/player/persistent-mpv-runtime";
import { PersistentMpvSession } from "@/infra/player/PersistentMpvSession";

const MPV_BIN = Bun.which("mpv");
const mpvTest = MPV_BIN ? test : test.skip;

let tempDir: string | null = null;

afterEach(async () => {
  if (!tempDir) return;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function pcmWav(durationMs: number, frequencyHz: number): Uint8Array {
  const sampleRate = 8_000;
  const sampleCount = Math.max(1, Math.round((sampleRate * durationMs) / 1_000));
  const dataBytes = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < sampleCount; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate) * 8_000);
    view.setInt16(44 + i * 2, sample, true);
  }
  return bytes;
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

mpvTest("real mpv reuses one process across two local loadfile transitions", async () => {
  tempDir = await mkdtemp(join(tmpdir(), "kunai-mpv-transition-"));
  const firstPath = join(tempDir, "first.wav");
  const secondPath = join(tempDir, "second.wav");
  await Promise.all([
    // Long enough for mpv to publish a positive time-pos sample before EOF;
    // that is Kunai's confirmed playback-started boundary.
    Bun.write(firstPath, pcmWav(1_000, 440)),
    Bun.write(secondPath, pcmWav(1_000, 660)),
  ]);

  const children: Array<ReturnType<typeof Bun.spawn>> = [];
  const runtime: PersistentMpvSessionRuntime = {
    which: () => MPV_BIN,
    spawn(command, options) {
      const separator = command.indexOf("--");
      const headless = ["--force-window=no", "--vo=null", "--ao=null", "--really-quiet"];
      const cmd =
        separator === -1
          ? [...command, ...headless]
          : [...command.slice(0, separator), ...headless, ...command.slice(separator)];
      const child = Bun.spawn(cmd, options);
      children.push(child);
      return child;
    },
    waitForIpcEndpoint: async (...args) => {
      const { waitForMpvIpcEndpoint } = await import("@/infra/player/mpv-ipc");
      return await waitForMpvIpcEndpoint(...args);
    },
    openIpcSession: async (options) => {
      const { openMpvIpcSession } = await import("@/infra/player/mpv-ipc");
      return await openMpvIpcSession(options);
    },
  };

  const firstEvents: string[] = [];
  const secondEvents: string[] = [];
  let session: PersistentMpvSession | null = null;
  try {
    session = await PersistentMpvSession.create({
      stream: { url: firstPath, headers: {}, timestamp: Date.now() },
      options: {
        displayTitle: "Native transition 1",
        urlKind: "local",
        primarySubtitle: null,
        onPlaybackEvent: (event) => firstEvents.push(event.type),
      },
      mpv: { clean: true },
      kitsuneConfig: {
        mpvKunaiScriptPath: bundledKunaiMpvBridgePath(),
        mpvInProcessStreamReconnect: false,
        mpvInProcessStreamReconnectMaxAttempts: 0,
      } as never,
      onControlReady: () => {},
      runtime,
    });

    const first = await withTimeout(session.waitForCurrentPlayback(), "first local playback");
    expect(first.endReason).toBe("eof");

    const second = await withTimeout(
      session.play(
        { url: secondPath, headers: {}, timestamp: Date.now() },
        {
          displayTitle: "Native transition 2",
          urlKind: "local",
          primarySubtitle: null,
          onPlaybackEvent: (event) => secondEvents.push(event.type),
        },
      ),
      "second local playback",
    );
    expect(second.endReason).toBe("eof");

    expect(children).toHaveLength(1);
    expect(firstEvents).toContain("playback-started");
    expect(secondEvents).toContain("playback-started");
  } finally {
    await session?.close();
    await Promise.all(children.map(async (child) => await child.exited.catch(() => -1)));
  }
});
