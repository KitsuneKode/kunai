import { expect, test } from "bun:test";

import {
  resumeSecondsFromProgressPoint,
  toHistoryTimestamp,
} from "@/domain/playback/playback-progress-policy";
import type { PlaybackResult } from "@/domain/types";

function resultAt(
  watchedSeconds: number,
  duration: number,
  endReason: PlaybackResult["endReason"] = "quit",
): PlaybackResult {
  return {
    watchedSeconds,
    duration,
    endReason,
    lastNonZeroPositionSeconds: watchedSeconds,
    lastNonZeroDurationSeconds: duration,
  };
}

test("isResumeProgressPoint rejects at persist gate boundary", () => {
  expect(resumeSecondsFromProgressPoint({ positionSeconds: 10, durationSeconds: 600 })).toBe(0);
  expect(resumeSecondsFromProgressPoint({ positionSeconds: 11, durationSeconds: 600 })).toBe(11);
});

test("resumeSecondsFromProgressPoint keeps ordinary progress", () => {
  expect(resumeSecondsFromProgressPoint({ positionSeconds: 120, durationSeconds: 600 })).toBe(120);
});

test("resumeSecondsFromProgressPoint rejects tiny progress and preserves near-end resume", () => {
  expect(resumeSecondsFromProgressPoint({ positionSeconds: 10, durationSeconds: 600 })).toBe(0);
  expect(resumeSecondsFromProgressPoint({ positionSeconds: 598, durationSeconds: 600 })).toBe(598);
});

test("resumeSecondsFromProgressPoint keeps progress inside the credits", () => {
  expect(resumeSecondsFromProgressPoint({ positionSeconds: 520, durationSeconds: 600 })).toBe(520);
});

test("toHistoryTimestamp preserves last non-zero quit position", () => {
  expect(
    toHistoryTimestamp({
      ...resultAt(0, 600),
      lastNonZeroPositionSeconds: 180,
    }),
  ).toBe(180);
});

test("toHistoryTimestamp marks eof as complete duration", () => {
  expect(toHistoryTimestamp(resultAt(598, 600, "eof"))).toBe(600);
});

test("toHistoryTimestamp uses trusted progress when eof jumps to duration", () => {
  expect(
    toHistoryTimestamp({
      ...resultAt(2_000, 2_000, "eof"),
      lastNonZeroPositionSeconds: 2_000,
      lastTrustedProgressSeconds: 420,
    }),
  ).toBe(420);
});
