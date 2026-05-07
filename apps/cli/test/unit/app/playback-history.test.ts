import { describe, expect, test } from "bun:test";

import { shouldPersistHistory, toHistoryTimestamp } from "@/app/playback-history";
import type { PlaybackTimingMetadata } from "@/domain/types";

const creditsTiming: PlaybackTimingMetadata = {
  tmdbId: "1396",
  type: "series",
  intro: [],
  recap: [],
  credits: [{ startMs: 1_200_000, endMs: null }],
  preview: [],
};

describe("playback-history", () => {
  test("persists normally when watched long enough", () => {
    expect(
      shouldPersistHistory({
        watchedSeconds: 42,
        duration: 120,
        endReason: "quit",
      }),
    ).toBe(true);
  });

  test("persists completed playback even when watched seconds are missing", () => {
    const result = {
      watchedSeconds: 0,
      duration: 1440,
      endReason: "eof" as const,
    };

    expect(shouldPersistHistory(result)).toBe(true);
    expect(toHistoryTimestamp(result)).toBe(1440);
  });

  test("does not persist very short partial playback", () => {
    expect(
      shouldPersistHistory({
        watchedSeconds: 4,
        duration: 120,
        endReason: "quit",
      }),
    ).toBe(false);
  });

  test("does not persist zeroed eof results without duration evidence", () => {
    expect(
      shouldPersistHistory({
        watchedSeconds: 0,
        duration: 0,
        endReason: "eof",
        resultSource: "unknown",
      }),
    ).toBe(false);
  });

  test("toHistoryTimestamp prefers lastNonZero when watchedSeconds is zero on quit", () => {
    expect(
      toHistoryTimestamp({
        watchedSeconds: 0,
        duration: 1_500,
        endReason: "quit",
        lastNonZeroPositionSeconds: 420,
      }),
    ).toBe(420);
  });

  test("treats playback as complete once credits timing is reached", () => {
    const result = {
      watchedSeconds: 1201,
      duration: 1500,
      endReason: "quit" as const,
    };

    expect(shouldPersistHistory(result, creditsTiming)).toBe(true);
    expect(toHistoryTimestamp(result, creditsTiming)).toBe(1500);
  });

  test("does not complete a network-style eof jump beyond trusted progress", () => {
    const result = {
      watchedSeconds: 1500,
      duration: 1500,
      endReason: "eof" as const,
      lastNonZeroPositionSeconds: 1500,
      lastNonZeroDurationSeconds: 1500,
      lastTrustedProgressSeconds: 420,
    };

    expect(shouldPersistHistory(result)).toBe(true);
    expect(toHistoryTimestamp(result)).toBe(420);
  });

  test("does not persist a demoted eof with no trusted progress", () => {
    const result = {
      watchedSeconds: 0,
      duration: 1500,
      endReason: "unknown" as const,
      lastNonZeroPositionSeconds: 1500,
      lastNonZeroDurationSeconds: 1500,
      lastTrustedProgressSeconds: 0,
    };

    expect(shouldPersistHistory(result)).toBe(false);
  });

  test("does not complete weird error ends and keeps the last trusted timestamp", () => {
    const result = {
      watchedSeconds: 1499,
      duration: 1500,
      endReason: "error" as const,
      lastNonZeroPositionSeconds: 1499,
      lastNonZeroDurationSeconds: 1500,
      lastTrustedProgressSeconds: 420,
    };

    expect(shouldPersistHistory(result)).toBe(true);
    expect(toHistoryTimestamp(result)).toBe(420);
  });

  test("does not turn near-end error exits into completed history", () => {
    const result = {
      watchedSeconds: 1499,
      duration: 1500,
      endReason: "error" as const,
      lastNonZeroPositionSeconds: 1499,
      lastNonZeroDurationSeconds: 1500,
    };

    expect(shouldPersistHistory(result)).toBe(true);
    expect(toHistoryTimestamp(result)).toBe(1499);
  });
});
