import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import type { PlaybackTimingMetadata, StreamInfo } from "@/domain/types";
import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import type { PlayerOptions, PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import { stopSharedStreamGateway } from "@/infra/player/stream-gateway";
import { VlcPlayerService, type VlcRuntime } from "@/infra/player/vlc/vlc-player-service";
import type { JsonValue } from "@kunai/types";

afterEach(() => stopSharedStreamGateway());

type Answer = JsonValue | null;

/**
 * A scripted VLC that can be launched more than once. Polls answer
 * `answer()`; the test swaps it to move the fake file along.
 */
function fakeVlc() {
  const timers: Array<() => void> = [];
  const requests: string[] = [];
  const launches: string[][] = [];
  const kills: string[] = [];
  let answer: () => Answer = () => null;
  let exitCurrent: (code: number) => void = () => {};
  let clock = 1_000_000;
  const launchWaiters: Array<{ count: number; resolve: () => void }> = [];
  const runtime: VlcRuntime = {
    discover: () => "/usr/bin/vlc",
    spawn: (argv) => {
      launches.push([...argv]);
      for (const waiter of launchWaiters.filter((entry) => launches.length >= entry.count)) {
        waiter.resolve();
      }
      let resolveExit: (code: number) => void = () => {};
      const exited = new Promise<number>((resolve) => {
        resolveExit = resolve;
      });
      exitCurrent = resolveExit;
      return {
        exited,
        signalCode: null,
        kill: (signal) => {
          kills.push(String(signal ?? "SIGTERM"));
          resolveExit(0);
        },
      };
    },
    getJson: async (url) => {
      requests.push(url);
      return answer();
    },
    freePort: async () => 45678,
    makeSessionDir: async () => await mkdtemp(join(tmpdir(), "kunai-vlc-parity-")),
    removeSessionDir: async (dir) => await rm(dir, { recursive: true, force: true }),
    userConfigPath: () => "/nonexistent/vlcrc",
    setTimeout: (callback) => {
      timers.push(callback);
      return setTimeout(() => {}, 0);
    },
    clearTimeout: () => {},
    now: () => clock,
  };
  const settle = async () => {
    // Session setup does real file I/O; let it and every queued promise run.
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  return {
    runtime,
    requests,
    launches,
    kills,
    settle,
    /** Resolves once VLC has been launched `count` times, then lets the first poll queue. */
    launched: async (count = 1) => {
      if (launches.length < count) {
        const wait = Promise.withResolvers<void>();
        launchWaiters.push({ count, resolve: wait.resolve });
        await wait.promise;
      }
      await settle();
    },
    setAnswer: (next: () => Answer) => {
      answer = next;
    },
    /** Advance the clock one poll interval and run the next queued timer. */
    poll: async () => {
      clock += 500;
      timers.shift()?.();
      await settle();
    },
    /** Drop queued timers (a finished file's poll loop) before the next file. */
    clearTimers: () => {
      timers.length = 0;
    },
    exit: async (code = 0) => {
      exitCurrent(code);
      await settle();
    },
  };
}

function playing(position: number, length = 1_440, displayed = position * 24): JsonValue {
  return {
    state: "playing",
    time: Math.floor(position),
    length,
    position: position / length,
    stats: { displayedpictures: displayed, decodedvideo: displayed },
    information: {
      category: {
        "Stream 0": { Type: "Video", Codec: "H264" },
        "Stream 1": { Type: "Audio", Codec: "AAC" },
      },
    },
  };
}

const STOPPED: JsonValue = { state: "stopped", time: 0, length: 0, position: 0, information: {} };

const STREAM: StreamInfo = { url: "https://cdn.example/ep.mp4", headers: {}, timestamp: 0 };

const TIMING: PlaybackTimingMetadata = {
  tmdbId: "1",
  type: "series",
  recap: [],
  intro: [{ startMs: 30_000, endMs: 90_400 }],
  credits: [],
  preview: [],
};

function harness() {
  const vlc = fakeVlc();
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
  const generations: PlaybackGeneration[] = [];
  const options = (over: Partial<PlayerOptions> = {}): PlayerOptions => ({
    url: STREAM.url,
    displayTitle: "Show · S1E1",
    onPlaybackEvent: ({ event }) => events.push(event),
    onGenerationActivated: (generation) => generations.push(generation),
    ...over,
  });
  return { vlc, service, events, generations, options, active: () => active };
}

/** Poll a decoding file from `from` seconds, one second per poll. */
async function playFrom(h: ReturnType<typeof harness>, from: number, polls: number) {
  for (let i = 0; i < polls; i += 1) {
    const position = from + i;
    h.vlc.setAnswer(() => playing(position));
    await h.vlc.poll();
  }
}

const seeks = (requests: readonly string[]) =>
  requests.filter((url) => url.includes("command=seek")).map((url) => url.split("val=")[1]);

describe("VLC auto-skip", () => {
  test("inside the intro, VLC seeks to its end once and Kunai is told", async () => {
    const h = harness();
    const playback = h.service.play(STREAM, h.options({ timing: TIMING }));
    await h.vlc.launched();
    await playFrom(h, 20, 14);
    expect(seeks(h.vlc.requests)).toEqual(["90"]);
    expect(h.events).toContainEqual({ type: "segment-skipped", kind: "intro", automatic: true });
    await h.vlc.exit();
    await playback;
  });

  test("with auto-skip paused, the skip key still skips the segment under the playhead", async () => {
    const h = harness();
    const playback = h.service.play(STREAM, h.options({ timing: TIMING }));
    await h.vlc.launched();
    h.active()?.updateAutoSkipEnabled?.(false);
    await playFrom(h, 20, 14);
    expect(seeks(h.vlc.requests)).toEqual([]);
    expect(await h.active()?.skipCurrentSegment?.()).toBe(true);
    expect(seeks(h.vlc.requests)).toEqual(["90"]);
    expect(h.events).toContainEqual({ type: "segment-skipped", kind: "intro", automatic: false });
    await h.vlc.exit();
    await playback;
  });

  test("timing that arrives after launch is honoured", async () => {
    const h = harness();
    const playback = h.service.play(STREAM, h.options({ timing: null }));
    await h.vlc.launched();
    await playFrom(h, 20, 12);
    expect(seeks(h.vlc.requests)).toEqual([]);
    h.active()?.updateTiming?.(TIMING);
    expect(h.active()?.getTimingSnapshot?.()).toBe(TIMING);
    await playFrom(h, 40, 2);
    expect(seeks(h.vlc.requests)).toEqual(["90"]);
    await h.vlc.exit();
    await playback;
  });
});

describe("VLC keeps its window for the next episode", () => {
  test("autoplay-chain: the file ends, the window stays, the next episode plays in it", async () => {
    const h = harness();
    const chain = h.options({ playbackMode: "autoplay-chain" });

    const first = h.service.play(STREAM, chain);
    await h.vlc.launched();
    expect(h.vlc.launches[0]).toContain("--play-and-stop");
    await playFrom(h, 1_430, 10);
    h.vlc.setAnswer(() => STOPPED);
    await h.vlc.poll();
    const firstResult = await first;
    expect(firstResult.endReason).toBe("eof");
    expect(h.vlc.kills).toEqual([]);

    h.vlc.clearTimers();
    h.vlc.setAnswer(() => playing(5));
    const second = h.service.play({ ...STREAM, url: "https://cdn.example/ep2.mp4" }, chain);
    await h.vlc.settle();
    expect(h.vlc.launches).toHaveLength(1);
    const inPlay = h.vlc.requests.find((url) => url.includes("command=in_play"));
    expect(inPlay).toContain(encodeURIComponent("https://cdn.example/ep2.mp4"));
    expect(h.generations).toEqual([
      { process: 1, cycle: 1 },
      { process: 1, cycle: 2 },
    ]);

    // Kunai's "next" stops the file and keeps the window.
    await playFrom(h, 5, 3);
    await h.active()?.stopCurrentFile?.("next");
    expect((await second).endReason).toBe("quit");
    expect(h.vlc.kills).toEqual([]);

    // Leaving the chain (post-play, exit) closes it.
    await h.service.releasePersistentSession();
    expect(h.vlc.kills).toEqual(["SIGTERM"]);
  });

  test("a file the kept window never opens ends as an error after its grace", async () => {
    const h = harness();
    const chain = h.options({ playbackMode: "autoplay-chain" });
    h.vlc.setAnswer(() => STOPPED);
    const playback = h.service.play(STREAM, chain);
    await h.vlc.launched();
    for (let i = 0; i < 8; i += 1) await h.vlc.poll();
    expect((await playback).endReason).toBe("error");
    await h.service.releasePersistentSession();
  });

  test("a window the user closed between episodes is replaced by a fresh VLC", async () => {
    const h = harness();
    const chain = h.options({ playbackMode: "autoplay-chain" });
    const first = h.service.play(STREAM, chain);
    await h.vlc.launched();
    await playFrom(h, 1_430, 10);
    h.vlc.setAnswer(() => STOPPED);
    await h.vlc.poll();
    await first;

    await h.vlc.exit(0);
    h.vlc.clearTimers();
    const second = h.service.play(STREAM, chain);
    await h.vlc.launched(2);
    expect(h.vlc.launches).toHaveLength(2);
    expect(h.generations.at(-1)).toEqual({ process: 2, cycle: 1 });
    await h.vlc.exit(0);
    await second;
  });

  test("outside autoplay-chain VLC exits with its file, as before", async () => {
    const h = harness();
    const playback = h.service.play(STREAM, h.options());
    await h.vlc.launched();
    expect(h.vlc.launches[0]).toContain("--play-and-exit");
    await playFrom(h, 1_430, 10);
    // A poll can catch VLC's last "stopped" status before it exits; the file
    // still ends where it was, not as a file that never opened.
    h.vlc.setAnswer(() => STOPPED);
    await h.vlc.poll();
    await h.vlc.exit(0);
    expect((await playback).endReason).toBe("eof");
  });
});
