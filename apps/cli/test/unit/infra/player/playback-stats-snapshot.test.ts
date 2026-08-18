import { describe, expect, test } from "bun:test";

import { describePlaybackStatsSnapshot } from "@/domain/playback/playback-stats-snapshot";
import { applyObservedPropertySample, createPlayerStatsState } from "@/infra/player/mpv-stats";
import { buildPlaybackStatsSnapshot } from "@/infra/player/PlaybackStatsSnapshot";
import { PlayerControlServiceImpl } from "@/infra/player/PlayerControlServiceImpl";

function makeService() {
  return new PlayerControlServiceImpl({
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
      child() {
        return this;
      },
    },
    diagnostics: {
      record() {},
    },
  });
}

describe("playback stats snapshot", () => {
  test("builds a read-only snapshot from the latest mpv stats sample", () => {
    const stats = createPlayerStatsState("/tmp/kunai-mpv.sock");

    applyObservedPropertySample(stats, {
      name: "playback-time",
      value: 734,
      observedAt: 1_000,
    });
    applyObservedPropertySample(stats, {
      name: "duration",
      value: 1_440,
      observedAt: 1_010,
    });
    applyObservedPropertySample(stats, {
      name: "demuxer-cache-duration",
      value: 8.45,
      observedAt: 1_020,
    });
    applyObservedPropertySample(stats, {
      name: "cache-speed",
      value: 2_000_000,
      observedAt: 1_030,
    });
    applyObservedPropertySample(stats, {
      name: "cache-buffering-state",
      value: 73,
      observedAt: 1_040,
    });
    applyObservedPropertySample(stats, {
      name: "paused-for-cache",
      value: true,
      observedAt: 1_050,
    });
    applyObservedPropertySample(stats, {
      name: "seeking",
      value: false,
      observedAt: 1_060,
    });
    applyObservedPropertySample(stats, {
      name: "vo-configured",
      value: true,
      observedAt: 1_070,
    });

    expect(buildPlaybackStatsSnapshot(stats)).toEqual({
      positionSeconds: 734,
      durationSeconds: 1_440,
      cacheAheadSeconds: 8.45,
      cacheSpeedBytesPerSecond: 2_000_000,
      bufferingPercent: 73,
      seeking: false,
      pausedForCache: true,
      voConfigured: true,
      updatedAt: 1_070,
    });
  });

  test("formats snapshot progress and network diagnostics for shell display", () => {
    expect(
      describePlaybackStatsSnapshot({
        positionSeconds: 734,
        durationSeconds: 1_440,
        cacheAheadSeconds: 8.45,
        cacheSpeedBytesPerSecond: 2_000_000,
        bufferingPercent: 73,
        pausedForCache: true,
        seeking: false,
        voConfigured: true,
        updatedAt: 1_070,
      }),
    ).toBe("12:14 / 24:00 · 8.5s cached · 2.0 MB/s · buffering 73%");

    expect(
      describePlaybackStatsSnapshot({
        seeking: true,
        voConfigured: false,
        updatedAt: 1_080,
      }),
    ).toBe("seeking · video output pending");
  });

  test("PlayerControlServiceImpl exposes the active player stats snapshot", () => {
    const service = makeService();

    expect(service.getStatsSnapshot()).toBeNull();

    service.setActive({
      id: "player-1",
      async stop() {},
      getStatsSnapshot() {
        return {
          positionSeconds: 12,
          durationSeconds: 120,
          updatedAt: 1_000,
        };
      },
    });

    expect(service.getStatsSnapshot()).toEqual({
      positionSeconds: 12,
      durationSeconds: 120,
      updatedAt: 1_000,
    });
  });
});
