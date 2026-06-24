import { describe, expect, test } from "bun:test";

import {
  createPlaybackProgressThrottleState,
  shouldEmitPlaybackProgress,
} from "@/infra/player/mpv-playback-kernel";

describe("mpv playback progress kernel", () => {
  test("throttles frequent progress samples", () => {
    const state = createPlaybackProgressThrottleState();
    const sample = { positionSeconds: 30, durationSeconds: 1200 };
    expect(shouldEmitPlaybackProgress(state, sample, 1_000)).toBe(true);
    expect(shouldEmitPlaybackProgress(state, sample, 2_000)).toBe(false);
    expect(
      shouldEmitPlaybackProgress(state, { positionSeconds: 50, durationSeconds: 1200 }, 3_000),
    ).toBe(true);
  });
});
