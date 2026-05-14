import { describe, expect, test } from "bun:test";

import { describePlaybackTelemetrySnapshot } from "@/domain/playback/playback-telemetry-snapshot";
import {
  applyObservedPropertySample,
  createPlayerTelemetryState,
} from "@/infra/player/mpv-telemetry";
import { buildPlaybackTelemetrySnapshot } from "@/infra/player/PlaybackTelemetrySnapshot";
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
    diagnosticsStore: {
      record() {},
      getRecent() {
        return [];
      },
      getSnapshot() {
        return [];
      },
      clear() {},
    },
  });
}

describe("playback telemetry snapshot", () => {
  test("builds a read-only snapshot from the latest mpv telemetry sample", () => {
    const telemetry = createPlayerTelemetryState("/tmp/kunai-mpv.sock");

    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 734,
      observedAt: 1_000,
    });
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 1_440,
      observedAt: 1_010,
    });
    applyObservedPropertySample(telemetry, {
      name: "demuxer-cache-duration",
      value: 8.45,
      observedAt: 1_020,
    });
    applyObservedPropertySample(telemetry, {
      name: "cache-speed",
      value: 2_000_000,
      observedAt: 1_030,
    });
    applyObservedPropertySample(telemetry, {
      name: "cache-buffering-state",
      value: 73,
      observedAt: 1_040,
    });
    applyObservedPropertySample(telemetry, {
      name: "paused-for-cache",
      value: true,
      observedAt: 1_050,
    });
    applyObservedPropertySample(telemetry, {
      name: "seeking",
      value: false,
      observedAt: 1_060,
    });
    applyObservedPropertySample(telemetry, {
      name: "vo-configured",
      value: true,
      observedAt: 1_070,
    });

    expect(buildPlaybackTelemetrySnapshot(telemetry)).toEqual({
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
      describePlaybackTelemetrySnapshot({
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
      describePlaybackTelemetrySnapshot({
        seeking: true,
        voConfigured: false,
        updatedAt: 1_080,
      }),
    ).toBe("seeking · video output pending");
  });

  test("PlayerControlServiceImpl exposes the active player telemetry snapshot", () => {
    const service = makeService();

    expect(service.getTelemetrySnapshot()).toBeNull();

    service.setActive({
      id: "player-1",
      async stop() {},
      getTelemetrySnapshot() {
        return {
          positionSeconds: 12,
          durationSeconds: 120,
          updatedAt: 1_000,
        };
      },
    });

    expect(service.getTelemetrySnapshot()).toEqual({
      positionSeconds: 12,
      durationSeconds: 120,
      updatedAt: 1_000,
    });
  });
});
