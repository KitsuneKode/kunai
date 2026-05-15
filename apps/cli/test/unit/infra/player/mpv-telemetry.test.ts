import { describe, expect, test } from "bun:test";

import {
  applyEndFileEvent,
  applyObservedPropertySample,
  createPlayerTelemetryState,
  finalizePlaybackResult,
  mapMpvEndReason,
  noteStreamStall,
  recordPlayerExit,
} from "@/infra/player/mpv-telemetry";

describe("mpv-telemetry", () => {
  test("maps mpv end-file reasons into domain end reasons", () => {
    expect(mapMpvEndReason("eof")).toBe("eof");
    expect(mapMpvEndReason("quit")).toBe("quit");
    expect(mapMpvEndReason("stop")).toBe("quit");
    expect(mapMpvEndReason("error")).toBe("error");
    expect(mapMpvEndReason("other")).toBe("unknown");
  });

  test("prefers the strongest latest ipc snapshot for eof playback", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 1437,
      observedAt: 100,
    });
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 1440,
      observedAt: 110,
    });
    applyEndFileEvent(telemetry, "eof", 120);
    recordPlayerExit(telemetry, { code: 0, signal: null });

    expect(
      finalizePlaybackResult(telemetry, {
        socketPathCleanedUp: true,
      }),
    ).toEqual({
      watchedSeconds: 1440,
      duration: 1440,
      endReason: "eof",
      resultSource: "ipc",
      playerExitedCleanly: true,
      playerExitCode: 0,
      playerExitSignal: null,
      socketPathCleanedUp: true,
      lastNonZeroPositionSeconds: 1440,
      lastNonZeroDurationSeconds: 1440,
      lastTrustedProgressSeconds: 1437,
      lastReliableProgressSeconds: 1437,
    });
  });

  test("uses the last non-zero ipc sample when later idle updates zero the live snapshot", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 612,
      observedAt: 100,
    });
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 1440,
      observedAt: 110,
    });
    applyObservedPropertySample(telemetry, {
      name: "idle-active",
      value: true,
      observedAt: 120,
    });
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 0,
      observedAt: 130,
    });
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 0,
      observedAt: 140,
    });
    recordPlayerExit(telemetry, { code: 0, signal: "SIGTERM" });

    expect(
      finalizePlaybackResult(telemetry, {
        socketPathCleanedUp: true,
      }),
    ).toEqual({
      watchedSeconds: 612,
      duration: 1440,
      endReason: "quit",
      resultSource: "ipc",
      playerExitedCleanly: false,
      playerExitCode: 0,
      playerExitSignal: "SIGTERM",
      socketPathCleanedUp: true,
      lastNonZeroPositionSeconds: 612,
      lastNonZeroDurationSeconds: 1440,
      lastTrustedProgressSeconds: 612,
      lastReliableProgressSeconds: 612,
    });
  });

  test("uses last non-zero position when quit with final sample stuck at zero", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 300,
      observedAt: 100,
    });
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 1_500,
      observedAt: 110,
    });
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 0,
      observedAt: 120,
    });
    recordPlayerExit(telemetry, { code: 0, signal: "SIGTERM" });

    const result = finalizePlaybackResult(telemetry, { socketPathCleanedUp: true });
    expect(result.watchedSeconds).toBe(300);
    expect(result.endReason).toBe("quit");
  });

  test("can ignore stale playback samples while mpv is replacing files", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    applyObservedPropertySample(
      telemetry,
      {
        name: "playback-time",
        value: 612,
        observedAt: 100,
      },
      { acceptPlaybackProperties: false },
    );
    applyObservedPropertySample(
      telemetry,
      {
        name: "duration",
        value: 1440,
        observedAt: 110,
      },
      { acceptPlaybackProperties: false },
    );
    recordPlayerExit(telemetry, { code: 0, signal: "SIGTERM" });

    const result = finalizePlaybackResult(telemetry, { socketPathCleanedUp: true });
    expect(result.watchedSeconds).toBe(0);
    expect(result.duration).toBe(0);
    expect(result.lastNonZeroPositionSeconds).toBe(0);
  });

  test("maps clean instant exits without eof evidence to quit", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    recordPlayerExit(telemetry, { code: 0, signal: null });

    expect(
      finalizePlaybackResult(telemetry, {
        socketPathCleanedUp: true,
      }),
    ).toEqual({
      watchedSeconds: 0,
      duration: 0,
      endReason: "quit",
      resultSource: "unknown",
      playerExitedCleanly: true,
      playerExitCode: 0,
      playerExitSignal: null,
      socketPathCleanedUp: true,
      lastNonZeroPositionSeconds: 0,
      lastNonZeroDurationSeconds: 0,
      lastTrustedProgressSeconds: 0,
      lastReliableProgressSeconds: 0,
    });
  });

  test("returns an error result for non-clean instant exits with no useful telemetry", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    recordPlayerExit(telemetry, { code: 2, signal: null });

    expect(
      finalizePlaybackResult(telemetry, {
        socketPathCleanedUp: false,
      }),
    ).toEqual({
      watchedSeconds: 0,
      duration: 0,
      endReason: "error",
      resultSource: "unknown",
      playerExitedCleanly: false,
      playerExitCode: 2,
      playerExitSignal: null,
      socketPathCleanedUp: false,
      lastNonZeroPositionSeconds: 0,
      lastNonZeroDurationSeconds: 0,
      lastTrustedProgressSeconds: 0,
      lastReliableProgressSeconds: 0,
    });
  });

  test("does not inflate progress when pause updates arrive", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 64,
      observedAt: 100,
    });
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 600,
      observedAt: 101,
    });
    applyObservedPropertySample(telemetry, {
      name: "pause",
      value: true,
      observedAt: 120,
    });
    recordPlayerExit(telemetry, { code: 0, signal: "SIGTERM" });

    const result = finalizePlaybackResult(telemetry, {
      socketPathCleanedUp: true,
    });

    expect(result.watchedSeconds).toBe(64);
    expect(result.duration).toBe(600);
    expect(result.endReason).toBe("quit");
  });

  test("demotes eof to unknown after a recent stream stall when trusted progress is far from duration", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    for (let pos = 0; pos <= 400; pos += 50) {
      applyObservedPropertySample(telemetry, {
        name: "playback-time",
        value: pos,
        observedAt: 1_000 + pos,
      });
    }
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 2000,
      observedAt: 2_000,
    });
    noteStreamStall(telemetry, 2_100_000);
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 2000,
      observedAt: 2_100_050,
    });
    applyEndFileEvent(telemetry, "eof", 2_100_120);
    recordPlayerExit(telemetry, { code: 0, signal: null });

    const result = finalizePlaybackResult(telemetry, { socketPathCleanedUp: true });
    expect(result.endReason).toBe("unknown");
    expect(result.watchedSeconds).toBe(400);
    expect(result.duration).toBe(2000);
  });

  test("demotes eof for network demuxer when trusted progress is far below duration (no stall)", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    for (let pos = 0; pos <= 400; pos += 50) {
      applyObservedPropertySample(telemetry, {
        name: "playback-time",
        value: pos,
        observedAt: 1_000 + pos,
      });
    }
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 2000,
      observedAt: 2_000,
    });
    applyObservedPropertySample(telemetry, {
      name: "demuxer-via-network",
      value: true,
      observedAt: 2_010,
    });
    applyEndFileEvent(telemetry, "eof", 2_050_000);
    recordPlayerExit(telemetry, { code: 0, signal: null });

    const result = finalizePlaybackResult(telemetry, { socketPathCleanedUp: true });
    expect(result.endReason).toBe("unknown");
    expect(result.watchedSeconds).toBe(400);
    expect(result.lastTrustedProgressSeconds).toBe(400);
  });

  test("demotes eof without stall when trusted progress is still very early in a long file", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    for (let pos = 0; pos <= 200; pos += 50) {
      applyObservedPropertySample(telemetry, {
        name: "playback-time",
        value: pos,
        observedAt: 1_000 + pos,
      });
    }
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 2000,
      observedAt: 2_000,
    });
    applyEndFileEvent(telemetry, "eof", 2_050_000);
    recordPlayerExit(telemetry, { code: 0, signal: null });

    const result = finalizePlaybackResult(telemetry, { socketPathCleanedUp: true });
    expect(result.endReason).toBe("unknown");
    expect(result.watchedSeconds).toBe(200);
  });

  test("does not trust a first playback sample that jumps straight to network eof", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 2_000,
      observedAt: 1_000,
    });
    applyObservedPropertySample(telemetry, {
      name: "demuxer-via-network",
      value: true,
      observedAt: 1_010,
    });
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 2_000,
      observedAt: 1_020,
    });
    applyEndFileEvent(telemetry, "eof", 1_030);
    recordPlayerExit(telemetry, { code: 0, signal: null });

    const result = finalizePlaybackResult(telemetry, { socketPathCleanedUp: true });
    expect(result.endReason).toBe("unknown");
    expect(result.watchedSeconds).toBe(0);
    expect(result.lastTrustedProgressSeconds).toBe(0);
  });

  test("demotes eof after a paused network stream disconnects without eof-reached evidence", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 2_400,
      observedAt: 1_000,
    });
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 2_820,
      observedAt: 1_010,
    });
    applyObservedPropertySample(telemetry, {
      name: "demuxer-via-network",
      value: true,
      observedAt: 1_020,
    });
    applyObservedPropertySample(telemetry, {
      name: "pause",
      value: true,
      observedAt: 1_100,
    });
    applyEndFileEvent(telemetry, "eof", 901_100);
    recordPlayerExit(telemetry, { code: 0, signal: null });

    const result = finalizePlaybackResult(telemetry, { socketPathCleanedUp: true });
    expect(result.endReason).toBe("unknown");
    expect(result.watchedSeconds).toBe(2_400);
    expect(result.duration).toBe(2_820);
  });

  test("trusts eof after pause when mpv explicitly reports eof-reached", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 2_815,
      observedAt: 1_000,
    });
    applyObservedPropertySample(telemetry, {
      name: "duration",
      value: 2_820,
      observedAt: 1_010,
    });
    applyObservedPropertySample(telemetry, {
      name: "pause",
      value: true,
      observedAt: 1_100,
    });
    applyObservedPropertySample(telemetry, {
      name: "eof-reached",
      value: true,
      observedAt: 1_200,
    });
    applyEndFileEvent(telemetry, "eof", 1_210);
    recordPlayerExit(telemetry, { code: 0, signal: null });

    const result = finalizePlaybackResult(telemetry, { socketPathCleanedUp: true });
    expect(result.endReason).toBe("eof");
    expect(result.watchedSeconds).toBe(2_820);
  });

  test("tracks mpv buffering and seeking diagnostics without changing progress", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    applyObservedPropertySample(telemetry, {
      name: "playback-time",
      value: 32,
      observedAt: 100,
    });
    applyObservedPropertySample(telemetry, {
      name: "paused-for-cache",
      value: true,
      observedAt: 110,
    });
    applyObservedPropertySample(telemetry, {
      name: "demuxer-cache-duration",
      value: 5.25,
      observedAt: 111,
    });
    applyObservedPropertySample(telemetry, {
      name: "cache-speed",
      value: 1_000_000,
      observedAt: 112,
    });
    applyObservedPropertySample(telemetry, {
      name: "seeking",
      value: true,
      observedAt: 113,
    });

    expect(telemetry.latestIpcSample?.positionSeconds).toBe(32);
    expect(telemetry.latestIpcSample?.pausedForCache).toBe(true);
    expect(telemetry.latestIpcSample?.demuxerCacheDurationSeconds).toBe(5.25);
    expect(telemetry.latestIpcSample?.cacheSpeedBytesPerSecond).toBe(1_000_000);
    expect(telemetry.latestIpcSample?.seeking).toBe(true);
  });
});
