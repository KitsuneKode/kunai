import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundledKunaiMpvBridgePath } from "@/infra/player/kunai-mpv-bridge";
import type { PersistentMpvSessionRuntime } from "@/infra/player/persistent-mpv-runtime";
import { PersistentMpvSession } from "@/infra/player/PersistentMpvSession";
import { createPlaybackOutputGate } from "@/infra/player/playback-output-gate";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigService";

// Real mpv against real media: the readiness gate's whole point is that mpv's
// clock lies about video, so only mpv itself can prove the gate reads it right.
function mpvBin(): string | null {
  return Bun.which("mpv");
}
function ffmpegBin(): string | null {
  return Bun.which("ffmpeg");
}
const nativeTest = mpvBin() && ffmpegBin() ? test : test.skip;

let tempDir: string | null = null;

afterEach(async () => {
  if (!tempDir) return;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

/** Three seconds of h264 + AAC in MPEG-TS; `dropVideo` keeps the video track but drops every packet. */
async function makeClip(path: string, dropVideo: boolean): Promise<void> {
  const proc = Bun.spawn(
    [
      ffmpegBin()!,
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
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      // dropamount=1 drops every video packet: deterministic on any ffmpeg
      // since 4.x, unlike corrupting packets, which decoders recover from
      // differently version to version.
      ...(dropVideo ? ["-bsf:v", "noise=dropamount=1"] : []),
      "-f",
      "mpegts",
      path,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg failed: ${await new Response(proc.stderr).text()}`);
}

function headlessRuntime(): PersistentMpvSessionRuntime {
  return {
    which: () => mpvBin(),
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
    // One clock second instead of ten keeps the native run short; the gate's
    // behaviour at the real default is covered by its unit tests.
    createPlaybackOutputGate: () => createPlaybackOutputGate(1),
  };
}

async function playToEnd(path: string): Promise<PlayerPlaybackEvent[]> {
  const events: PlayerPlaybackEvent[] = [];
  const session = await PersistentMpvSession.create({
    stream: { url: path, headers: {}, timestamp: Date.now() },
    options: {
      displayTitle: "Readiness fixture",
      urlKind: "local",
      primarySubtitle: null,
      onPlaybackEvent: (event) => events.push(event),
    },
    mpv: { clean: true },
    kitsuneConfig: {
      ...DEFAULT_CONFIG,
      mpvKunaiScriptPath: bundledKunaiMpvBridgePath(),
      mpvInProcessStreamReconnect: false,
      mpvInProcessStreamReconnectMaxAttempts: 0,
    },
    onControlReady: () => {},
    runtime: headlessRuntime(),
  });
  try {
    let deadline: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      session.waitForCurrentPlayback(),
      new Promise<never>((_, reject) => {
        // sleep-allow: deadline around a real mpv process
        deadline = setTimeout(() => reject(new Error("native playback timed out")), 15_000);
      }),
    ]).finally(() => {
      if (deadline) clearTimeout(deadline);
    });
  } finally {
    await session.close();
  }
  return events;
}

nativeTest("a decoding video starts playback on its first frame", async () => {
  tempDir = await mkdtemp(join(tmpdir(), "kunai-readiness-"));
  const clip = join(tempDir, "healthy.ts");
  await makeClip(clip, false);

  const types = (await playToEnd(clip)).map((event) => event.type);
  expect(types).toContain("playback-started");
  expect(types).not.toContain("video-not-decoding");
});

nativeTest("a video track that never decodes is reported, never started", async () => {
  tempDir = await mkdtemp(join(tmpdir(), "kunai-readiness-"));
  const clip = join(tempDir, "no-frames.ts");
  await makeClip(clip, true);

  const events = await playToEnd(clip);
  const types = events.map((event) => event.type);
  // Audio played the whole clip, so the old clock rule would have said "started".
  expect(types).not.toContain("playback-started");
  expect(types).not.toContain("playback-progress");
  expect(events).toContainEqual(
    expect.objectContaining({ type: "video-not-decoding", codec: "h264" }),
  );
});
