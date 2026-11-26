import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createPlaybackWatchdog } from "@/infra/player/playback-watchdog";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";

describe("playback-watchdog", () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalDateNow = Date.now;

  type TimerEntry = {
    id: number;
    callback: () => void;
  };

  let timers: TimerEntry[] = [];
  let nowMs = 0;
  let nextTimerId = 1;

  const runTimers = () => {
    for (const timer of timers) {
      timer.callback();
    }
  };

  const setupHarness = () => {
    timers = [];
    nowMs = 0;
    nextTimerId = 1;

    globalThis.setInterval = ((callback: (...args: unknown[]) => void) => {
      const id = nextTimerId++;
      timers.push({
        id,
        callback: callback as () => void,
      });
      return id as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;

    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      const resolvedId = Number(id as unknown as number);
      timers = timers.filter((timer) => timer.id !== resolvedId);
    }) as unknown as typeof clearInterval;

    Date.now = () => nowMs;
  };

  beforeEach(() => {
    setupHarness();
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    Date.now = originalDateNow;
    timers = [];
  });

  test("the first sample starts the progress clock after a slow player launch", () => {
    const events: PlayerPlaybackEvent[] = [];
    const watchdog = createPlaybackWatchdog((event) => events.push(event), { stallAfterMs: 1_000 });
    nowMs = 30_000;
    watchdog.observe({
      source: "ipc",
      observedAt: nowMs,
      positionSeconds: 0,
      durationSeconds: 100,
    });
    runTimers();
    expect(events.filter((event) => event.type === "stream-stalled")).toHaveLength(0);
    nowMs += 1_100;
    runTimers();
    expect(events.filter((event) => event.type === "stream-stalled")).toHaveLength(1);
    watchdog.stop();
  });

  test("a new file resets the old position, samples and stall clocks", () => {
    const events: PlayerPlaybackEvent[] = [];
    const watchdog = createPlaybackWatchdog((event) => events.push(event), { stallAfterMs: 1_000 });
    watchdog.observe({ source: "ipc", observedAt: 0, positionSeconds: 600, durationSeconds: 800 });
    nowMs = 5_000;
    watchdog.reset();
    runTimers();
    expect(events.filter((event) => event.type === "stream-stalled")).toHaveLength(0);
    watchdog.observe({
      source: "ipc",
      observedAt: nowMs,
      positionSeconds: 0,
      durationSeconds: 100,
    });
    nowMs += 800;
    watchdog.observe({
      source: "ipc",
      observedAt: nowMs,
      positionSeconds: 1,
      durationSeconds: 100,
    });
    nowMs += 800;
    runTimers();
    expect(events.filter((event) => event.type === "stream-stalled")).toHaveLength(0);
    nowMs += 300;
    runTimers();
    expect(events.filter((event) => event.type === "stream-stalled")).toHaveLength(1);
    watchdog.stop();
  });

  test.each([false, true])("cache-idle recovery respects explicit user pause=%s", (paused) => {
    const events: PlayerPlaybackEvent[] = [];
    const watchdog = createPlaybackWatchdog((event) => events.push(event), {
      networkReadDeadAfterMs: 1_000,
      cacheStallAfterMs: 2_000,
    });
    watchdog.observe({
      source: "ipc",
      observedAt: 0,
      positionSeconds: 30,
      durationSeconds: 100,
      paused,
      coreIdle: true,
      pausedForCache: true,
      demuxerViaNetwork: true,
      demuxerCacheUnderrun: true,
      demuxerRawInputRate: 0,
    });
    runTimers();
    nowMs = 1_100;
    runTimers();
    const stalls = events.filter((event) => event.type === "stream-stalled");
    expect(stalls).toHaveLength(paused ? 0 : 1);
    if (!paused) expect(stalls[0]).toMatchObject({ stallKind: "network-read-dead" });
    nowMs = 1_200;
    runTimers();
    expect(events.filter((event) => event.type === "stream-stalled")).toHaveLength(paused ? 0 : 1);
    watchdog.stop();
  });

  test("does not emit stream-stalled after long user pause then resume", () => {
    const events: PlayerPlaybackEvent[] = [];
    const watchdog = createPlaybackWatchdog(
      (event) => {
        events.push(event);
      },
      {
        intervalMs: 100,
        stallAfterMs: 1_000,
        seekStallAfterMs: 700,
        cacheStallAfterMs: 1_500,
      },
    );

    watchdog.observe({
      source: "ipc",
      observedAt: 0,
      positionSeconds: 10,
      durationSeconds: 120,
    });

    nowMs = 200;
    runTimers();

    watchdog.observe({
      source: "ipc",
      observedAt: 200,
      positionSeconds: 10,
      durationSeconds: 120,
      paused: true,
    });

    nowMs = 4_000;
    runTimers();

    watchdog.observe({
      source: "ipc",
      observedAt: 4_050,
      positionSeconds: 10,
      durationSeconds: 120,
      paused: false,
    });

    nowMs = 4_500;
    runTimers();

    const stalledEvents = events.filter((event) => event.type === "stream-stalled");
    expect(stalledEvents).toHaveLength(0);

    watchdog.stop();
  });

  test("emits stream-stalled when paused-for-cache remains starved", () => {
    const events: PlayerPlaybackEvent[] = [];
    const watchdog = createPlaybackWatchdog(
      (event) => {
        events.push(event);
      },
      {
        intervalMs: 100,
        stallAfterMs: 2_000,
        seekStallAfterMs: 700,
        cacheStallAfterMs: 500,
      },
    );

    watchdog.observe({
      source: "ipc",
      observedAt: 0,
      positionSeconds: 50,
      durationSeconds: 200,
      pausedForCache: true,
      demuxerCacheDurationSeconds: 0,
      cacheSpeedBytesPerSecond: 0,
    });

    nowMs = 200;
    runTimers();
    nowMs = 400;
    runTimers();
    nowMs = 700;
    runTimers();

    const stalledEvents = events.filter((event) => event.type === "stream-stalled");
    expect(stalledEvents.length).toBeGreaterThan(0);

    const bufferingEvents = events.filter((event) => event.type === "network-buffering");
    expect(bufferingEvents.length).toBeGreaterThan(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "stream-slow",
        state: "buffering-observed",
      }),
    );

    watchdog.stop();
  });

  test("emits slow-network-suspected before treating buffering as a dead stream", () => {
    const events: PlayerPlaybackEvent[] = [];
    const watchdog = createPlaybackWatchdog((event) => events.push(event), {
      intervalMs: 100,
      stallAfterMs: 10_000,
      seekStallAfterMs: 700,
      cacheStallAfterMs: 5_000,
      networkReadDeadAfterMs: 5_000,
      slowNetworkAfterMs: 500,
    });

    watchdog.observe({
      source: "ipc",
      observedAt: 0,
      positionSeconds: 50,
      durationSeconds: 200,
      pausedForCache: true,
      demuxerViaNetwork: true,
      demuxerCacheUnderrun: true,
      demuxerRawInputRate: 128,
      demuxerCacheDurationSeconds: 0.1,
      cacheSpeedBytesPerSecond: 128,
    });

    nowMs = 600;
    runTimers();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "stream-slow",
        state: "slow-network-suspected",
        secondsBuffering: 1,
      }),
    );
    expect(events.filter((event) => event.type === "stream-stalled")).toHaveLength(0);

    watchdog.stop();
  });

  test("emits stream-stalled with network-read-dead when demuxer underrun and zero read rate persist", () => {
    const events: PlayerPlaybackEvent[] = [];
    const watchdog = createPlaybackWatchdog(
      (event) => {
        events.push(event);
      },
      {
        intervalMs: 100,
        stallAfterMs: 10_000,
        seekStallAfterMs: 700,
        cacheStallAfterMs: 5_000,
        networkReadDeadAfterMs: 500,
      },
    );

    watchdog.observe({
      source: "ipc",
      observedAt: 0,
      positionSeconds: 40,
      durationSeconds: 2000,
      pausedForCache: true,
      demuxerViaNetwork: true,
      demuxerCacheUnderrun: true,
      demuxerRawInputRate: 0,
      demuxerCacheDurationSeconds: 0,
      cacheSpeedBytesPerSecond: 0,
    });

    nowMs = 0;
    runTimers();
    nowMs = 600;
    runTimers();

    const dead = events.filter(
      (e) => e.type === "stream-stalled" && e.stallKind === "network-read-dead",
    );
    expect(dead.length).toBe(1);

    watchdog.stop();
  });

  test("can emit a fresh stream stall after a seek resolves without progress", () => {
    const events: PlayerPlaybackEvent[] = [];
    const watchdog = createPlaybackWatchdog((event) => events.push(event), {
      intervalMs: 100,
      stallAfterMs: 500,
      seekStallAfterMs: 300,
      cacheStallAfterMs: 2_000,
    });

    watchdog.observe({
      source: "ipc",
      observedAt: 0,
      positionSeconds: 30,
      durationSeconds: 120,
    });

    nowMs = 600;
    runTimers();
    expect(events.filter((event) => event.type === "stream-stalled")).toHaveLength(1);

    watchdog.observe({
      source: "ipc",
      observedAt: 700,
      positionSeconds: 30,
      durationSeconds: 120,
      seeking: true,
    });
    nowMs = 800;
    runTimers();
    nowMs = 1_100;
    runTimers();
    expect(events.filter((event) => event.type === "seek-stalled")).toHaveLength(1);

    watchdog.observe({
      source: "ipc",
      observedAt: 1_200,
      positionSeconds: 30,
      durationSeconds: 120,
      seeking: false,
    });
    nowMs = 1_800;
    runTimers();

    expect(events.filter((event) => event.type === "stream-stalled")).toHaveLength(2);

    watchdog.stop();
  });

  test("a backward seek followed by normal playback is progress, not a stall", () => {
    const events: PlayerPlaybackEvent[] = [];
    const watchdog = createPlaybackWatchdog((event) => events.push(event), {
      intervalMs: 100,
      stallAfterMs: 500,
      seekStallAfterMs: 300,
      cacheStallAfterMs: 2_000,
    });
    const sample = (observedAt: number, positionSeconds: number, seeking?: boolean) =>
      watchdog.observe({
        source: "ipc",
        observedAt,
        positionSeconds,
        durationSeconds: 1_200,
        seeking,
      });

    // Playing normally up to 100 s.
    sample(0, 99);
    sample(100, 100);
    // Seek back to 20 s.
    sample(200, 100, true);
    sample(300, 20, false);
    // Then play on from 20 s, well past stallAfterMs, never reaching 100 s.
    for (let step = 1; step <= 10; step += 1) {
      nowMs = 300 + step * 100;
      sample(nowMs, 20 + step * 0.5);
      runTimers();
    }

    expect(events.filter((event) => event.type === "stream-stalled")).toEqual([]);
    watchdog.stop();
  });

  test("emits throttled network samples for passive speed diagnostics", () => {
    const events: PlayerPlaybackEvent[] = [];
    const watchdog = createPlaybackWatchdog((event) => events.push(event), {
      networkSampleEveryMs: 2_500,
    });

    watchdog.observe({
      source: "ipc",
      observedAt: 10_000,
      positionSeconds: 10,
      durationSeconds: 600,
      demuxerViaNetwork: true,
      demuxerCacheDurationSeconds: 14,
      cacheSpeedBytesPerSecond: 2_000_000,
    });
    watchdog.observe({
      source: "ipc",
      observedAt: 11_000,
      positionSeconds: 11,
      durationSeconds: 600,
      demuxerViaNetwork: true,
      demuxerCacheDurationSeconds: 15,
      cacheSpeedBytesPerSecond: 2_100_000,
    });
    watchdog.observe({
      source: "ipc",
      observedAt: 13_000,
      positionSeconds: 13,
      durationSeconds: 600,
      demuxerViaNetwork: true,
      demuxerCacheDurationSeconds: 17,
      cacheSpeedBytesPerSecond: 2_200_000,
    });
    watchdog.stop();

    const samples = events.filter((event) => event.type === "network-sample");
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({
      type: "network-sample",
      cacheAheadSeconds: 14,
      cacheSpeed: 2_000_000,
      demuxerViaNetwork: true,
    });
  });

  describe("video lost while the clock runs", () => {
    const VIDEO = [{ id: 1, type: "video", selected: true, codec: "h264" }];
    const NO_VIDEO = [{ id: 1, type: "video", selected: false, codec: "h264" }];
    const at = (
      positionSeconds: number,
      extra: Partial<Parameters<ReturnType<typeof createPlaybackWatchdog>["observe"]>[0]> = {},
    ) => ({
      source: "ipc" as const,
      observedAt: positionSeconds * 1000,
      positionSeconds,
      durationSeconds: 1400,
      trackList: VIDEO,
      ...extra,
    });
    const videoLost = (events: PlayerPlaybackEvent[]) =>
      events.filter((event) => event.type === "stream-stalled" && event.stallKind === "video-lost");

    test("frames that stop for ten clock seconds raise one video-lost stall", () => {
      const events: PlayerPlaybackEvent[] = [];
      const watchdog = createPlaybackWatchdog((event) => events.push(event));
      watchdog.observe(at(100, { videoOutParams: { w: 1920, h: 1080 } }));
      watchdog.observe(at(101));
      watchdog.observe(at(110.5));
      expect(videoLost(events)).toHaveLength(0);
      watchdog.observe(at(111));
      watchdog.observe(at(115));
      expect(videoLost(events)).toEqual([
        {
          type: "stream-stalled",
          secondsWithoutProgress: 10,
          stallKind: "video-lost",
          duringStartup: false,
        },
      ]);
      watchdog.stop();
    });

    test("a returning frame clears the incident, so a later loss is reported again", () => {
      const events: PlayerPlaybackEvent[] = [];
      const watchdog = createPlaybackWatchdog((event) => events.push(event), {
        videoLostAfterSeconds: 2,
      });
      watchdog.observe(at(10, { voConfigured: true }));
      watchdog.observe(at(11));
      watchdog.observe(at(13));
      watchdog.observe(at(14, { voConfigured: true }));
      watchdog.observe(at(15));
      watchdog.observe(at(17));
      expect(videoLost(events)).toHaveLength(2);
      watchdog.stop();
    });

    test("no stall before the first frame, with video turned off, or while paused or seeking", () => {
      const events: PlayerPlaybackEvent[] = [];
      const watchdog = createPlaybackWatchdog((event) => events.push(event), {
        videoLostAfterSeconds: 2,
      });
      // Never decoded: that is the startup gate's call, not a mid-playback stall.
      watchdog.observe(at(1));
      watchdog.observe(at(9));
      watchdog.observe(at(10, { videoOutParams: { w: 2, h: 2 } }));
      // The user turned video off.
      watchdog.observe(at(11, { trackList: NO_VIDEO }));
      watchdog.observe(at(20, { trackList: NO_VIDEO }));
      // Paused or seeking: the incident clock restarts.
      watchdog.observe(at(21, { paused: true }));
      watchdog.observe(at(25, { seeking: true }));
      watchdog.observe(at(26, { paused: true }));
      expect(videoLost(events)).toHaveLength(0);
      watchdog.stop();
    });
  });
});
