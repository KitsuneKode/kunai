import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { networkSampleShowsBytes } from "@/app/playback/playback-source-failover";
import { bundledKunaiMpvBridgePath } from "@/infra/player/kunai-mpv-bridge";
import type { PersistentMpvSessionRuntime } from "@/infra/player/persistent-mpv-runtime";
import { PersistentMpvSession } from "@/infra/player/PersistentMpvSession";
import { createPlaybackOutputGate } from "@/infra/player/playback-output-gate";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigService";

// Real mpv against a local HTTP server: the startup no-bytes rule and the
// same-URL reconnect rule both rest on what mpv itself reports, so only mpv
// can show they read it right. Ported in spirit from the dcqwqc/kunai fork's
// stream-recovery-native test.
const nativeTest = ["mpv", "ffmpeg"].every((name) => Bun.which(name)) ? test : test.skip;

/** Resolved when a test runs; `nativeTest` already skipped the file without it. */
function binary(name: "mpv" | "ffmpeg"): string {
  const path = Bun.which(name);
  if (!path) throw new Error(`${name} is not installed`);
  return path;
}

let tempDir: string | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(async () => {
  await server?.stop(true);
  server = null;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function makeClip(path: string, seconds: number): Promise<void> {
  const proc = Bun.spawn(
    [
      binary("ffmpeg"),
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      String(seconds),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      "-f",
      "mpegts",
      path,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
}

function headlessRuntime(): PersistentMpvSessionRuntime {
  return {
    which: () => binary("mpv"),
    spawn(command, options) {
      const separator = command.indexOf("--");
      const headless = ["--force-window=no", "--vo=null", "--ao=null", "--really-quiet"];
      const cmd =
        separator === -1
          ? [...command, ...headless]
          : [...command.slice(0, separator), ...headless, ...command.slice(separator)];
      return Bun.spawn(cmd, options);
    },
    waitForIpcEndpoint: async (...args) => {
      const { waitForMpvIpcEndpoint } = await import("@/infra/player/mpv-ipc");
      return await waitForMpvIpcEndpoint(...args);
    },
    openIpcSession: async (options) => {
      const { openMpvIpcSession } = await import("@/infra/player/mpv-ipc");
      return await openMpvIpcSession(options);
    },
    createPlaybackOutputGate: () => createPlaybackOutputGate(1),
  };
}

/**
 * Play `url` in real mpv until `done` says so, or the deadline passes; then
 * close mpv. Returns every event the session emitted.
 */
async function watch(
  url: string,
  done: (events: readonly PlayerPlaybackEvent[]) => boolean,
  options: { readonly reconnectAttempts?: number; readonly deadlineMs: number },
): Promise<{ events: PlayerPlaybackEvent[]; endReason: string | null }> {
  const events: PlayerPlaybackEvent[] = [];
  const settled = Promise.withResolvers<void>();
  const session = await PersistentMpvSession.create({
    stream: { url, headers: {}, timestamp: Date.now() },
    options: {
      displayTitle: "Recovery fixture",
      primarySubtitle: null,
      onPlaybackEvent: (event) => {
        events.push(event);
        if (done(events)) settled.resolve();
      },
    },
    mpv: { clean: true },
    kitsuneConfig: {
      ...DEFAULT_CONFIG,
      mpvKunaiScriptPath: bundledKunaiMpvBridgePath(),
      mpvInProcessStreamReconnect: (options.reconnectAttempts ?? 0) > 0,
      mpvInProcessStreamReconnectMaxAttempts: options.reconnectAttempts ?? 0,
    },
    onControlReady: () => {},
    runtime: headlessRuntime(),
  });
  let endReason: string | null = null;
  const playback = session.waitForCurrentPlayback().then((result) => {
    endReason = result.endReason;
    settled.resolve();
    return result;
  });
  // sleep-allow: deadline around a real mpv process and a real socket
  const deadline = setTimeout(() => settled.resolve(), options.deadlineMs);
  try {
    await settled.promise;
  } finally {
    clearTimeout(deadline);
    await session.close();
    await playback.catch(() => null);
  }
  return { events, endReason };
}

const bytesArrived = (events: readonly PlayerPlaybackEvent[]) =>
  events.some((event) => event.type === "network-sample" && networkSampleShowsBytes(event));

nativeTest(
  "a server that trickles media is seen sending bytes before playback starts",
  async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kunai-recovery-"));
    const clip = join(tempDir, "clip.ts");
    await makeClip(clip, 20);
    const body = await readFile(clip);
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              // ~160 KB/s: slow enough that mpv waits on its cache first.
              for (let offset = 0; offset < body.length; offset += 16_384) {
                controller.enqueue(body.subarray(offset, offset + 16_384));
                // sleep-allow: the server under test is deliberately slow
                await Bun.sleep(100);
              }
              controller.close();
            },
          }),
          { headers: { "content-type": "video/mp2t" } },
        ),
    });
    let startedBeforeBytes = false;
    const { events } = await watch(
      `http://127.0.0.1:${server.port}/slow.ts`,
      (seen) => {
        if (seen.at(-1)?.type === "playback-started" && !bytesArrived(seen)) {
          startedBeforeBytes = true;
        }
        return seen.some((event) => event.type === "playback-started");
      },
      { deadlineMs: 20_000 },
    );
    expect(bytesArrived(events)).toBe(true);
    expect(startedBeforeBytes).toBe(false);
  },
  40_000,
);

nativeTest(
  "a server that answers nothing shows no bytes",
  async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kunai-recovery-"));
    const hung = Promise.withResolvers<Response>();
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => hung.promise });
    const { events } = await watch(`http://127.0.0.1:${server.port}/hung.ts`, () => false, {
      deadlineMs: 4_000,
    });
    hung.resolve(new Response("late", { status: 503 }));
    expect(bytesArrived(events)).toBe(false);
    expect(events.map((event) => event.type)).not.toContain("playback-started");
  },
  30_000,
);

nativeTest(
  "a URL that answers 403 ends without a same-URL reload",
  async () => {
    let hits = 0;
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        hits += 1;
        return new Response("denied", { status: 403 });
      },
    });
    const { events, endReason } = await watch(
      `http://127.0.0.1:${server.port}/denied.ts`,
      () => false,
      { reconnectAttempts: 2, deadlineMs: 15_000 },
    );
    expect(endReason).toBe("error");
    expect(events.map((event) => event.type)).not.toContain("mpv-in-process-reconnect");
    // The preflight and mpv's own open; no reload on top.
    expect(hits).toBeLessThanOrEqual(2);
  },
  30_000,
);
