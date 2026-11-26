import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PlaybackResult, StreamInfo } from "@/domain/types";
import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import type { PlayerOptions, PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import { stopSharedStreamGateway } from "@/infra/player/stream-gateway";
import {
  VlcLaunchError,
  VlcPlayerService,
  type VlcRuntime,
} from "@/infra/player/vlc/vlc-player-service";
import type { JsonValue } from "@kunai/types";

afterEach(() => stopSharedStreamGateway());

type Script = (step: number) => JsonValue | null;

/** A scripted VLC: each poll answers `script(step)`; the test ends the process. */
function fakeVlc(script: Script, discovered: string | null = "/usr/bin/vlc") {
  const timers: Array<() => void> = [];
  const requests: string[] = [];
  let spawnedArgv: readonly string[] = [];
  let step = 0;
  let resolveExit: (code: number) => void = () => {};
  const kills: string[] = [];
  const spawned = Promise.withResolvers<void>();
  const runtime: VlcRuntime = {
    discover: () => discovered,
    spawn: (argv) => {
      spawnedArgv = argv;
      spawned.resolve();
      return {
        exited: new Promise<number>((resolve) => {
          resolveExit = resolve;
        }),
        signalCode: null,
        kill: (signal) => {
          kills.push(String(signal ?? "SIGTERM"));
          resolveExit(0);
        },
      };
    },
    getJson: async (url) => {
      requests.push(url);
      // Commands (`?command=…`) and the gate's direct reads answer with the
      // current step; only the poll loop advances it.
      return script(step);
    },
    freePort: async () => 45678,
    makeSessionDir: async () => await mkdtemp(join(tmpdir(), "kunai-vlc-test-")),
    removeSessionDir: async (dir) => await rm(dir, { recursive: true, force: true }),
    userConfigPath: () => "/nonexistent/vlcrc",
    setTimeout: (callback) => {
      timers.push(callback);
      return setTimeout(() => {}, 0);
    },
    clearTimeout: () => {},
    now: () => 1_000_000 + step * 500,
  };
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  return {
    runtime,
    requests,
    kills,
    argv: () => spawnedArgv,
    /** Resolves once VLC was launched (session setup does real file I/O first). */
    spawned: spawned.promise,
    /** Run one poll and let its async work settle. */
    poll: async () => {
      const next = timers.shift();
      next?.();
      await flush();
      step += 1;
      await flush();
    },
    exit: async (code = 0) => {
      resolveExit(code);
      await flush();
    },
  };
}

function status(input: {
  state?: string;
  position: number;
  length: number;
  displayed: number;
  video?: boolean;
}): JsonValue {
  return {
    state: input.state ?? "playing",
    time: Math.floor(input.position),
    length: input.length,
    position: input.length > 0 ? input.position / input.length : 0,
    stats: { displayedpictures: input.displayed, decodedvideo: input.displayed },
    information: {
      category:
        input.video === false
          ? { "Stream 0": { Type: "Audio", Codec: "AAC" } }
          : {
              "Stream 0": { Type: "Video", Codec: "H264" },
              "Stream 1": { Type: "Audio", Codec: "AAC" },
            },
    },
  };
}

const STREAM: StreamInfo = { url: "https://cdn.example/ep.mp4", headers: {}, timestamp: 0 };

function harness(script: Script, discovered?: string | null) {
  const vlc = fakeVlc(script, discovered);
  let active: ActivePlayerControl | null = null;
  const service = new VlcPlayerService({
    playerControl: {
      setActive: (control) => {
        active = control;
      },
      getActive: () => active,
    },
    runtime: vlc.runtime,
  });
  const events: PlayerPlaybackEvent[] = [];
  const options: PlayerOptions = {
    url: STREAM.url,
    displayTitle: "Show · S1E1",
    onPlaybackEvent: ({ event }) => events.push(event),
  };
  return { vlc, service, events, options, active: () => active };
}

const types = (events: readonly PlayerPlaybackEvent[]) => events.map((event) => event.type);

describe("VlcPlayerService", () => {
  test("a decoding stream starts, reports progress, and ends as a finished file", async () => {
    const h = harness((step) =>
      step === 0
        ? { state: "stopped", time: 0, length: 0, information: {} }
        : status({ position: Math.min(60, step * 6), length: 60, displayed: step * 50 }),
    );
    const playing = h.service.play(STREAM, h.options);
    await h.vlc.spawned;
    for (let i = 0; i < 12; i += 1) await h.vlc.poll();
    expect(h.active()).not.toBeNull();
    await h.vlc.exit(0);
    const result: PlaybackResult = await playing;

    expect(types(h.events)).toContain("launching-player");
    expect(types(h.events)).toContain("ipc-connected");
    expect(types(h.events)).toContain("playback-started");
    expect(types(h.events)).toContain("playback-progress");
    expect(result.endReason).toBe("eof");
    expect(result.duration).toBe(60);
    // The control is released once VLC is gone.
    expect(h.active()).toBeNull();
    // The control password never appears in argv.
    expect(h.vlc.argv().some((arg) => arg.includes("password"))).toBe(false);
  });

  test("a video stream with no pictures never starts and reports video-not-decoding", async () => {
    // VLC without an H.264 decoder: the video stream is listed, audio plays,
    // displayedpictures stays 0.
    const h = harness((step) => status({ position: step, length: 1400, displayed: 0 }));
    const playing = h.service.play(STREAM, h.options);
    await h.vlc.spawned;
    for (let i = 0; i < 16; i += 1) await h.vlc.poll();
    await h.vlc.exit(0);
    await playing;

    expect(types(h.events)).not.toContain("playback-started");
    expect(types(h.events)).not.toContain("playback-progress");
    expect(h.events).toContainEqual(
      expect.objectContaining({ type: "video-not-decoding", codec: "H264" }),
    );
  });

  test("closing VLC mid-episode is a quit at the position reached", async () => {
    const h = harness((step) => status({ position: step * 4, length: 1400, displayed: step * 40 }));
    const playing = h.service.play(STREAM, h.options);
    await h.vlc.spawned;
    for (let i = 0; i < 6; i += 1) await h.vlc.poll();
    await h.vlc.exit(0);
    const result = await playing;
    expect(result.endReason).toBe("quit");
    expect(result.watchedSeconds).toBeGreaterThan(10);
  });

  test("VLC that exits without opening the input is an error, not a quit", async () => {
    const h = harness(() => ({ state: "stopped", time: 0, length: 0, information: {} }));
    const playing = h.service.play(STREAM, h.options);
    await h.vlc.spawned;
    await h.vlc.poll();
    await h.vlc.exit(0);
    expect((await playing).endReason).toBe("error");
  });

  test("Kunai's stop sends pl_stop, ends the process, and reads as a quit", async () => {
    const h = harness((step) => status({ position: step * 2, length: 1400, displayed: step * 20 }));
    const playing = h.service.play(STREAM, h.options);
    await h.vlc.spawned;
    for (let i = 0; i < 3; i += 1) await h.vlc.poll();
    await h.active()?.stop("user");
    const result = await playing;
    expect(h.vlc.requests.some((url) => url.endsWith("?command=pl_stop"))).toBe(true);
    expect(h.vlc.kills).toEqual(["SIGTERM"]);
    expect(result.endReason).toBe("quit");
  });

  test("a stream that needs headers plays through the loopback gateway", async () => {
    const h = harness((step) => status({ position: step, length: 60, displayed: step * 10 }));
    const playing = h.service.play(
      { ...STREAM, headers: { Referer: "https://site.example/", Origin: "https://site.example" } },
      h.options,
    );
    await h.vlc.spawned;
    await h.vlc.poll();
    const url = h.vlc.argv().find((arg) => arg.startsWith("http"));
    expect(url).toStartWith("http://127.0.0.1:");
    expect(url).not.toContain("cdn.example");
    await h.vlc.exit(0);
    await playing;
  });

  test("refuses what VLC cannot play, naming the way out", async () => {
    const ytdl = harness(() => null);
    await expect(
      ytdl.service.play({ ...STREAM, requiresYtdl: true }, ytdl.options),
    ).rejects.toThrow("--player mpv");

    // Provider targets are HTTP(S) only, as with mpv: no files, no other schemes.
    for (const unsafe of [
      { ...STREAM, url: "file:///etc/passwd" },
      { ...STREAM, url: "--help" },
      { ...STREAM, subtitle: "file:///home/me/.ssh/id_ed25519" },
    ]) {
      const refused = harness(() => null);
      await expect(refused.service.play(unsafe, refused.options)).rejects.toThrow(
        "unsafe stream URL",
      );
    }

    const missing = harness(() => null, null);
    expect(await missing.service.isAvailable()).toBe(false);
    await expect(missing.service.play(STREAM, missing.options)).rejects.toBeInstanceOf(
      VlcLaunchError,
    );
  });
});
