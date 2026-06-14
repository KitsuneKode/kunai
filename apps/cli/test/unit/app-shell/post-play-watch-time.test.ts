import { describe, expect, it } from "bun:test";

import { aggregateWatchTime, formatWatchTimeSummary } from "@/app-shell/post-play-watch-time";

const row = (over: Partial<{ positionSeconds: number; updatedAt: string }>) => ({
  key: "k",
  titleId: "t",
  mediaKind: "series" as const,
  title: "Show",
  positionSeconds: 1200,
  completed: true,
  updatedAt: "2026-06-01T10:00:00.000Z",
  createdAt: "2026-06-01T10:00:00.000Z",
  ...over,
});

describe("aggregateWatchTime", () => {
  it("sums positions, counts episodes and distinct days", () => {
    const stats = aggregateWatchTime([
      row({ positionSeconds: 1200, updatedAt: "2026-06-01T10:00:00.000Z" }),
      row({ positionSeconds: 1500, updatedAt: "2026-06-01T22:00:00.000Z" }),
      row({ positionSeconds: 1800, updatedAt: "2026-06-03T09:00:00.000Z" }),
    ]);
    expect(stats.watchedSeconds).toBe(4500);
    expect(stats.episodeCount).toBe(3);
    expect(stats.dayCount).toBe(2);
  });

  it("returns null summary below a meaningful threshold", () => {
    expect(
      formatWatchTimeSummary({ watchedSeconds: 120, episodeCount: 1, dayCount: 1 }),
    ).toBeNull();
  });

  it("formats hours and days", () => {
    expect(formatWatchTimeSummary({ watchedSeconds: 39600, episodeCount: 28, dayCount: 9 })).toBe(
      "You watched ~11h over 9 days",
    );
  });

  it("uses singular day", () => {
    expect(formatWatchTimeSummary({ watchedSeconds: 7200, episodeCount: 4, dayCount: 1 })).toBe(
      "You watched ~2h over 1 day",
    );
  });
});
