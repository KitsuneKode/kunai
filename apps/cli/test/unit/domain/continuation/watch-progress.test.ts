import { describe, expect, test } from "bun:test";

import {
  projectSeriesProgress,
  projectWatchProgress,
} from "@/domain/continuation/watch-progress";

describe("watch progress projection", () => {
  test("clamps in-progress percentages to user-facing resume range", () => {
    expect(projectWatchProgress({ timestamp: 1, duration: 1_000 })).toMatchObject({
      percentage: 1,
      completed: false,
      inProgress: false,
    });
    expect(projectWatchProgress({ timestamp: 600, duration: 1_200 })).toMatchObject({
      percentage: 50,
      completed: false,
      inProgress: true,
    });
  });

  test("turns near-end or explicit completion into one completed projection", () => {
    expect(projectWatchProgress({ timestamp: 1_190, duration: 1_200 })).toMatchObject({
      percentage: 100,
      completed: true,
      inProgress: false,
    });
    expect(projectWatchProgress({ timestamp: 20, duration: 1_200, completed: true })).toMatchObject(
      {
        percentage: 100,
        completed: true,
        inProgress: false,
      },
    );
  });

  test("handles missing duration without inventing percentages", () => {
    expect(projectWatchProgress({ timestamp: 600 })).toEqual({
      percentage: null,
      completed: false,
      inProgress: true,
    });
  });
});

describe("series progress projection (distinct from episode progress)", () => {
  test("finishing a mid-series episode is NOT series-completed", () => {
    // Watched ep 8 of a series whose latest aired is 24 — episode done, series not.
    const series = projectSeriesProgress({
      latestWatchedEpisode: 8,
      latestAiredEpisode: 24,
      episodeFinished: true,
    });
    expect(series.seriesCompleted).toBe(false);
    expect(series.caughtUp).toBe(false);
    expect(series.percentage).toBe(33);
  });

  test("finishing the latest aired episode IS series-completed (caught up)", () => {
    const series = projectSeriesProgress({
      latestWatchedEpisode: 24,
      latestAiredEpisode: 24,
      episodeFinished: true,
    });
    expect(series.caughtUp).toBe(true);
    expect(series.seriesCompleted).toBe(true);
    expect(series.percentage).toBe(100);
  });

  test("caught up but NOT finished the latest episode → not yet series-completed", () => {
    const series = projectSeriesProgress({
      latestWatchedEpisode: 24,
      latestAiredEpisode: 24,
      episodeFinished: false,
    });
    expect(series.caughtUp).toBe(true);
    expect(series.seriesCompleted).toBe(false);
  });

  test("unknown aired total cannot claim completion", () => {
    const series = projectSeriesProgress({
      latestWatchedEpisode: 8,
      latestAiredEpisode: null,
      episodeFinished: true,
    });
    expect(series.percentage).toBeNull();
    expect(series.caughtUp).toBe(false);
    expect(series.seriesCompleted).toBe(false);
  });
});
