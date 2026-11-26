import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlaybackOutputGate } from "@/infra/player/playback-output-gate";
import type { PlayerControlService } from "@/infra/player/PlayerControlService";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import { defaultVlcRuntime, VlcPlayerService } from "@/infra/player/vlc/vlc-player-service";

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
      displayTitle: "Kunai VLC fixture",
      onPlaybackEvent: ({ event }) => events.push(event),
    },
  );
  return { result, events };
}

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
  30_000,
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
  30_000,
);
