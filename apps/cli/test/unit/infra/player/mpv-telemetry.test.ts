import { describe, expect, test } from "bun:test";

import {
  applyEndFileEvent,
  applyObservedPropertySample,
  createPlayerTelemetryState,
  finalizePlaybackResult,
  mapMpvEndReason,
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
    });
  });

  test("returns an unknown result for instant exits with no useful telemetry", () => {
    const telemetry = createPlayerTelemetryState("/tmp/mpv.sock");
    recordPlayerExit(telemetry, { code: 0, signal: null });

    expect(
      finalizePlaybackResult(telemetry, {
        socketPathCleanedUp: true,
      }),
    ).toEqual({
      watchedSeconds: 0,
      duration: 0,
      endReason: "unknown",
      resultSource: "unknown",
      playerExitedCleanly: true,
      playerExitCode: 0,
      playerExitSignal: null,
      socketPathCleanedUp: true,
      lastNonZeroPositionSeconds: 0,
      lastNonZeroDurationSeconds: 0,
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
});
