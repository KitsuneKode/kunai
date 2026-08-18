import { describe, expect, test } from "bun:test";

import {
  projectFurthestWatchedEpisode,
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

describe("furthest watched episode projection", () => {
  const entry = (
    season: number | undefined,
    episode: number | undefined,
    absoluteEpisode?: number,
  ) => ({ season, episode, absoluteEpisode });

  test("reports how far into the season the viewer has reached, not how many rows exist", () => {
    // Jumping straight to E08 is 8 episodes deep, not one episode watched.
    expect(
      projectFurthestWatchedEpisode({
        entries: [entry(1, 8)],
        season: 1,
      }),
    ).toBe(8);
  });

  test("ignores entries from other seasons", () => {
    expect(
      projectFurthestWatchedEpisode({
        entries: [entry(1, 8), entry(2, 12)],
        season: 1,
      }),
    ).toBe(8);
  });

  test("keeps season-less rows when no season is scoped (anime absolute numbering)", () => {
    expect(
      projectFurthestWatchedEpisode({
        entries: [entry(undefined, undefined, 40), entry(undefined, 12)],
      }),
    ).toBe(40);
  });

  test("never reports less than the episode currently being watched", () => {
    expect(
      projectFurthestWatchedEpisode({
        entries: [entry(1, 3)],
        season: 1,
        currentEpisode: 8,
      }),
    ).toBe(8);
  });

  test("no history and no current episode is zero, not a guess", () => {
    expect(projectFurthestWatchedEpisode({ entries: [] })).toBe(0);
  });
});
