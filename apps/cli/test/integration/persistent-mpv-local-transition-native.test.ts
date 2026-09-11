import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundledKunaiMpvBridgePath } from "@/infra/player/kunai-mpv-bridge";
import type { MpvIpcSession } from "@/infra/player/mpv-ipc";
import type { PersistentMpvSessionRuntime } from "@/infra/player/persistent-mpv-runtime";
import { PersistentMpvSession } from "@/infra/player/PersistentMpvSession";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigService";

const MPV_BIN = Bun.which("mpv");
const mpvTest = MPV_BIN ? test : test.skip;

function parseTlsObservations(output: string): string[] {
  // Lua's text-mode file writes use CRLF on Windows and LF on POSIX.
  return output.trim().split(/\r?\n/);
}

test.each(["\n", "\r\n"])("TLS observations accept native line ending %j", (lineEnding) => {
  expect(parseTlsObservations(["no", "no", "yes", ""].join(lineEnding))).toEqual([
    "no",
    "no",
    "yes",
  ]);
});

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
  let ipc: MpvIpcSession | undefined;
  const runtime: PersistentMpvSessionRuntime = {
    which: () => MPV_BIN,
    spawn(command, options) {
      const separator = command.indexOf("--");
      const headless = [
        "--pause=yes",
        "--force-window=no",
        "--vo=null",
        "--ao=null",
        "--really-quiet",
      ];
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
      ipc = await openMpvIpcSession(options);
      return ipc;
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
        ...DEFAULT_CONFIG,
        mpvKunaiScriptPath: bundledKunaiMpvBridgePath(),
        mpvInProcessStreamReconnect: false,
        mpvInProcessStreamReconnectMaxAttempts: 0,
      },
      onControlReady: () => {},
      runtime,
    });

    const initialPlayback = session.waitForCurrentPlayback();
    expect((await ipc!.send(["set_property", "pause", false])).ok).toBe(true);
    const first = await withTimeout(initialPlayback, "first local playback");
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

for (const [startsExceptional, baseline] of [
  [true, "yes"],
  [false, "yes"],
  [true, "no"],
] as const) {
  mpvTest(
    `TLS exception stays file-local with exceptional startup=${startsExceptional}, baseline=${baseline}`,
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), "kunai-mpv-tls-"));
      const mediaPath = join(tempDir, "fixture.wav");
      const scriptPath = join(tempDir, "tls-probe.lua");
      const observationsPath = join(tempDir, "observations.txt");
      await Bun.write(mediaPath, pcmWav(1_000, 440));
      // Real Kunai options are constructed for remote hosts. Only transport is
      // redirected, before opening: no DNS, provider or certificate fixture.
      // file-loaded observes mpv's effective option while that file is active.
      const luaString = (value: string) =>
        `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
      await Bun.write(
        scriptPath,
        `
      mp.add_hook("on_load", 1, function()
        mp.set_property("stream-open-filename", ${luaString(mediaPath)})
      end)
      mp.register_event("file-loaded", function()
        local file = assert(io.open(${luaString(observationsPath)}, "a"))
        file:write(mp.get_property("options/tls-verify") .. "\\n")
        file:close()
      end)
    `,
      );
      const children: Array<ReturnType<typeof Bun.spawn>> = [];
      let ipc: MpvIpcSession | undefined;
      const runtime: PersistentMpvSessionRuntime = {
        which: () => MPV_BIN,
        spawn(command, options) {
          // Model the user's enabled TLS verification independently of mpv's
          // build default (this mpv defaults to no); Kunai must restore it.
          const child = Bun.spawn(
            [
              command[0]!,
              "--pause=yes",
              `--tls-verify=${baseline}`,
              "--force-window=no",
              "--vo=null",
              "--ao=null",
              "--really-quiet",
              `--script=${scriptPath}`,
              ...command.slice(1),
            ],
            options,
          );
          children.push(child);
          return child;
        },
        waitForIpcEndpoint: async (...args) =>
          (await import("@/infra/player/mpv-ipc")).waitForMpvIpcEndpoint(...args),
        openIpcSession: async (options) => {
          ipc = await (await import("@/infra/player/mpv-ipc")).openMpvIpcSession(options);
          return ipc;
        },
      };
      const exceptional = "https://www.mp4upload.com/fixture.mp4";
      const normal = "https://example.com/fixture.mp4";
      const urls = startsExceptional
        ? [exceptional, exceptional, normal]
        : [normal, exceptional, normal];
      let session: PersistentMpvSession | undefined;
      try {
        session = await PersistentMpvSession.create({
          stream: { url: urls[0]!, headers: {}, timestamp: Date.now() },
          options: { displayTitle: "TLS scope", primarySubtitle: null },
          mpv: { clean: true },
          kitsuneConfig: {
            ...DEFAULT_CONFIG,
            mpvKunaiScriptPath: bundledKunaiMpvBridgePath(),
            mpvInProcessStreamReconnect: false,
            mpvInProcessStreamReconnectMaxAttempts: 0,
          },
          onControlReady() {},
          runtime,
        });
        const initialPlayback = session.waitForCurrentPlayback();
        expect((await ipc!.send(["set_property", "pause", false])).ok).toBe(true);
        expect((await withTimeout(initialPlayback, "TLS initial playback")).endReason).toBe("eof");
        for (const url of urls.slice(1))
          expect(
            (
              await withTimeout(
                session.play(
                  { url, headers: {}, timestamp: Date.now() },
                  { displayTitle: "TLS replacement", primarySubtitle: null },
                ),
                "TLS replacement playback",
              )
            ).endReason,
          ).toBe("eof");
        expect(children).toHaveLength(1);
        expect(parseTlsObservations(await Bun.file(observationsPath).text())).toEqual(
          startsExceptional ? ["no", "no", baseline] : [baseline, "no", baseline],
        );
      } finally {
        await session?.close();
        await Promise.all(children.map((child) => child.exited));
      }
    },
  );
}
