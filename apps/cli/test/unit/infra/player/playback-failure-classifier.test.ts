import { describe, expect, test } from "bun:test";

import {
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
