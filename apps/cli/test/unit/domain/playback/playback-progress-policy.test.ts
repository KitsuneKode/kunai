import { expect, test } from "bun:test";

import {
  resumeSecondsFromProgressPoint,
  toHistoryTimestamp,
} from "@/domain/playback/playback-progress-policy";
import type { PlaybackResult, PlaybackTimingMetadata } from "@/domain/types";

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
  expect(
    resumeSecondsFromProgressPoint(
      { positionSeconds: 10, durationSeconds: 600 },
      "credits-or-90-percent",
    ),
  ).toBe(0);
  expect(
    resumeSecondsFromProgressPoint(
      { positionSeconds: 11, durationSeconds: 600 },
      "credits-or-90-percent",
    ),
  ).toBe(11);
});

test("resumeSecondsFromProgressPoint keeps ordinary progress", () => {
  expect(
    resumeSecondsFromProgressPoint(
      { positionSeconds: 120, durationSeconds: 600 },
      "credits-or-90-percent",
    ),
  ).toBe(120);
});

test("resumeSecondsFromProgressPoint rejects tiny and near-end progress", () => {
  expect(
    resumeSecondsFromProgressPoint(
      { positionSeconds: 10, durationSeconds: 600 },
      "credits-or-90-percent",
    ),
  ).toBe(0);
  expect(
    resumeSecondsFromProgressPoint(
      { positionSeconds: 598, durationSeconds: 600 },
      "credits-or-90-percent",
    ),
  ).toBe(0);
});

test("resumeSecondsFromProgressPoint respects credits timing threshold", () => {
  const timing: PlaybackTimingMetadata = {
    tmdbId: "1396",
    type: "series",
    intro: [],
    recap: [],
    credits: [{ startMs: 500_000, endMs: 590_000 }],
    preview: [],
  };

  expect(
    resumeSecondsFromProgressPoint(
      { positionSeconds: 520, durationSeconds: 600 },
      "credits-or-90-percent",
      timing,
    ),
  ).toBe(0);
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
  expect(toHistoryTimestamp(resultAt(590, 600, "eof"))).toBe(600);
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
