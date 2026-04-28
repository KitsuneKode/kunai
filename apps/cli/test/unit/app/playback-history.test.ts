import { describe, expect, test } from "bun:test";

import { shouldPersistHistory, toHistoryTimestamp } from "@/app/playback-history";

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
});
