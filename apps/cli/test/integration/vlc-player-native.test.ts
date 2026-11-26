import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlaybackOutputGate } from "@/infra/player/playback-output-gate";
import type { PlayerControlService } from "@/infra/player/PlayerControlService";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import { defaultVlcRuntime, VlcPlayerService } from "@/infra/player/vlc/vlc-player-service";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";

import { nativeBinary } from "./helpers/native-binaries";

// Real VLC through Kunai's VLC player service: the control interface, the
// session config password, the status mapping and the decode gate together.
const VLC_BIN = nativeBinary("vlc");
const FFMPEG_BIN = nativeBinary("ffmpeg");
const nativeTest = VLC_BIN && FFMPEG_BIN ? test : test.skip;

let tempDir: string | null = null;
afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function makeClip(path: string, seconds: number): Promise<void> {
  const proc = Bun.spawn(
    [
      FFMPEG_BIN!,
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
      path,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
}

async function playThroughVlc(path: string, extraArgs: readonly string[]) {
  let active: Parameters<PlayerControlService["setActive"]>[0] = null;
  const service = new VlcPlayerService({
    playerControl: { setActive: (control) => (active = control), getActive: () => active },
    runtime: {
      ...defaultVlcRuntime,
      // Headless: no window, no sound, the user's VLC interface not shown.
      extraArgs: ["--intf=dummy", "--vout=dummy", "--aout=dummy", ...extraArgs],
      // Two clock seconds instead of ten keeps the run short.
      createPlaybackOutputGate: () => createPlaybackOutputGate(2),
    },
  });
  const events: PlayerPlaybackEvent[] = [];
  const result = await service.play(
    { url: path, headers: {}, timestamp: Date.now() },
    {
      url: path,
      localPlaybackSource: localClip(path),
      displayTitle: "Kunai VLC fixture",
      onPlaybackEvent: ({ event }) => events.push(event),
    },
  );
  return { result, events };
}

/** The verified-library source production attaches to every local file it plays. */
function localClip(path: string): LocalPlaybackSource {
  return {
    kind: "local",
    jobId: "fixture",
    titleId: "fixture",
    titleName: "Kunai VLC fixture",
    mediaKind: "series",
    providerId: "fixture",
    filePath: path,
  };
}

// Real VLC plus ffmpeg-made clips: alone each test takes a few seconds, but in
// the full parallel suite VLC's startup alone can pass 30 s. This is runner
// headroom for a real process, not a wait the assertions depend on.
const NATIVE_VLC_TIMEOUT_MS = 90_000;

nativeTest(
  "real VLC: a decoding clip starts, progresses and finishes",
  async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kunai-vlc-native-"));
    const clip = join(tempDir, "healthy.mp4");
    await makeClip(clip, 4);
    const { result, events } = await playThroughVlc(clip, []);
    const types = events.map((event) => event.type);
    expect(types).toContain("ipc-connected");
    expect(types).toContain("playback-started");
    expect(types).not.toContain("video-not-decoding");
    expect(result.endReason).toBe("eof");
  },
  NATIVE_VLC_TIMEOUT_MS,
);

nativeTest(
  "real VLC: video that never reaches the output is reported, never started",
  async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kunai-vlc-native-"));
    const clip = join(tempDir, "no-picture.mp4");
    await makeClip(clip, 5);
    // VLC's dummy decoder consumes video without producing pictures — the same
    // signal as a missing H.264 decoder, measured in the VLC dossier.
    const { events } = await playThroughVlc(clip, ["--codec=dummy"]);
    const types = events.map((event) => event.type);
    expect(types).not.toContain("playback-started");
    expect(events).toContainEqual(expect.objectContaining({ type: "video-not-decoding" }));
  },
  NATIVE_VLC_TIMEOUT_MS,
);

function headlessService(spawned: string[][]) {
  let active: Parameters<PlayerControlService["setActive"]>[0] = null;
  const service = new VlcPlayerService({
    playerControl: { setActive: (control) => (active = control), getActive: () => active },
    runtime: {
      ...defaultVlcRuntime,
      spawn: (argv) => {
        spawned.push([...argv]);
        return defaultVlcRuntime.spawn(argv);
      },
      extraArgs: ["--intf=dummy", "--vout=dummy", "--aout=dummy"],
      createPlaybackOutputGate: () => createPlaybackOutputGate(2),
    },
  });
  return service;
}

nativeTest(
  "real VLC: autoplay-chain plays the next episode in the same window",
  async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kunai-vlc-native-"));
    const first = join(tempDir, "ep1.mp4");
    const second = join(tempDir, "ep 2.mp4");
    await makeClip(first, 4);
    await makeClip(second, 4);
    const spawned: string[][] = [];
    const service = headlessService(spawned);
    const play = async (path: string) => {
      const events: PlayerPlaybackEvent[] = [];
      const result = await service.play(
        { url: path, headers: {}, timestamp: Date.now() },
        {
          url: path,
          localPlaybackSource: localClip(path),
          displayTitle: "Kunai VLC chain",
          playbackMode: "autoplay-chain",
          onPlaybackEvent: ({ event }) => events.push(event),
        },
      );
      return { result, events };
    };
    try {
      const one = await play(first);
      expect(one.result.endReason).toBe("eof");
      // A local path with a space reaches in_play as a file URI.
      const two = await play(second);
      expect(two.result.endReason).toBe("eof");
      expect(two.events.map((event) => event.type)).toContain("playback-started");
      expect(spawned).toHaveLength(1);
    } finally {
      await service.releasePersistentSession();
    }
  },
  45_000,
);

nativeTest(
  "real VLC: an intro is skipped by seeking past it",
  async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kunai-vlc-native-"));
    const clip = join(tempDir, "intro.mp4");
    await makeClip(clip, 12);
    const service = headlessService([]);
    const events: PlayerPlaybackEvent[] = [];
    const positions: Array<number | "skipped"> = [];
    const result = await service.play(
      { url: clip, headers: {}, timestamp: Date.now() },
      {
        url: clip,
        localPlaybackSource: localClip(clip),
        displayTitle: "Kunai VLC skip",
        timing: {
          tmdbId: "1",
          type: "series",
          recap: [],
          intro: [{ startMs: 1_000, endMs: 9_000 }],
          credits: [],
          preview: [],
        },
        onPlaybackEvent: ({ event }) => {
          events.push(event);
          if (event.type === "segment-skipped") positions.push("skipped");
        },
        onProgress: (seconds) => positions.push(seconds),
      },
    );
    expect(events).toContainEqual({ type: "segment-skipped", kind: "intro", automatic: true });
    expect(result.endReason).toBe("eof");
    // The seek lands before Kunai reports the skip: every later position is past the intro.
    const after = positions
      .slice(positions.indexOf("skipped") + 1)
      .filter((entry): entry is number => entry !== "skipped");
    expect(after.length).toBeGreaterThan(0);
    expect(Math.min(...after)).toBeGreaterThanOrEqual(8.5);
  },
  NATIVE_VLC_TIMEOUT_MS,
);
