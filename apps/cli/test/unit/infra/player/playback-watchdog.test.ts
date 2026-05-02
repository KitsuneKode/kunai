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

    watchdog.stop();
  });
});
