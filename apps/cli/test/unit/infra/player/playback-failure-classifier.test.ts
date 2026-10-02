import { describe, expect, test } from "bun:test";

import {
  classifyPlaybackFailureFromEvent,
  classifyPlaybackFailureFromResult,
  recoveryForPlaybackFailure,
} from "@/infra/player/playback-failure-classifier";

describe("playback recovery guidance", () => {
  test("player exit recommends relaunch before provider fallback", () => {
    const guidance = recoveryForPlaybackFailure("player-exited");

    expect(guidance.action).toBe("relaunch");
    expect(guidance.label).toContain("Relaunch mpv");
    expect(guidance.label).not.toContain("fallback provider");
  });

  test("expired stream recommends refresh", () => {
    expect(recoveryForPlaybackFailure("expired-stream").action).toBe("refresh");
  });

  test("slow stream evidence recommends waiting before fallback", () => {
    const failure = classifyPlaybackFailureFromEvent({
      type: "stream-slow",
      state: "slow-network-suspected",
      secondsBuffering: 8,
      cacheAheadSeconds: 0.2,
      cacheSpeed: 256,
    });

    expect(failure).toBe("slow-stream");
    expect(recoveryForPlaybackFailure(failure).action).toBe("wait");
  });

  test("suspected dead stream results are treated as expired streams", () => {
    expect(
      classifyPlaybackFailureFromResult({
        watchedSeconds: 400,
        duration: 2000,
        endReason: "unknown",
        suspectedDeadStream: true,
      }),
    ).toBe("expired-stream");
  });
});

describe("stream-stalled classification", () => {
  test("cache-starved is a source failure — refresh, not inspect", () => {
    const failure = classifyPlaybackFailureFromEvent({
      type: "stream-stalled",
      secondsWithoutProgress: 22,
      stallKind: "cache-starved",
    });
    expect(failure).toBe("expired-stream");
    expect(recoveryForPlaybackFailure(failure).action).toBe("refresh");
  });

  test("no-progress mid-playback is a wait-or-refresh, not an inspect", () => {
    const failure = classifyPlaybackFailureFromEvent({
      type: "stream-stalled",
      secondsWithoutProgress: 14,
      stallKind: "no-progress",
    });
    expect(failure).toBe("slow-stream");
    expect(recoveryForPlaybackFailure(failure).action).toBe("wait");
  });

  test("slow-open is a wait condition, never a stall verdict", () => {
    const failure = classifyPlaybackFailureFromEvent({
      type: "stream-slow",
      state: "slow-open",
      secondsBuffering: 18,
    });
    expect(failure).toBe("network-buffering");
    expect(recoveryForPlaybackFailure(failure).action).toBe("wait");
  });
});
