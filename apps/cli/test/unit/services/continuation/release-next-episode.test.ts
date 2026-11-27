import { describe, expect, test } from "bun:test";

import { continueReleaseFromProjection } from "@/services/continuation/release-next-episode";
import type { HistoryProgress, ReleaseProgressProjection } from "@kunai/storage";

function projection(over: Partial<ReleaseProgressProjection> = {}): ReleaseProgressProjection {
  return {
    titleId: "tmdb:1",
    mediaKind: "series",
    source: "tmdb",
    title: "Show",
    anchorSeason: 1,
    anchorEpisode: 3,
    latestAiredSeason: 1,
    latestAiredEpisode: 10,
    newEpisodeCount: 0,
    status: "caught-up",
    checkedAt: "2026-11-20T00:00:00.000Z",
    nextCheckAt: "2026-11-21T00:00:00.000Z",
    staleAfterAt: "2026-11-21T00:00:00.000Z",
    sourceFingerprint: "series:10",
    errorCount: 0,
    ...over,
  };
}

function finished(over: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "tmdb:1:1:3",
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Show",
    season: 1,
    episode: 3,
    positionSeconds: 1400,
    durationSeconds: 1440,
    completed: true,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    ...over,
  };
}

describe("continueReleaseFromProjection", () => {
  test("a finished episode behind the latest aired one has a released next", () => {
    // Reconciliation calls an old backlog "caught-up" (nothing aired since the
    // last watch), but episode 4 exists.
    expect(continueReleaseFromProjection(projection(), finished())).toEqual({
      status: "released",
      releaseAt: null,
      season: 1,
      episode: 4,
    });
  });

  test("the history row wins over an older projection anchor", () => {
    const release = continueReleaseFromProjection(
      projection({ status: "new-episodes", newEpisodeCount: 7, anchorEpisode: 3 }),
      finished({ episode: 6 }),
    );
    expect(release).toMatchObject({ status: "released", season: 1, episode: 7 });
  });

  test("watching the latest aired episode is caught up, not a replay of the projection's next", () => {
    const release = continueReleaseFromProjection(
      projection({ status: "new-episodes", newEpisodeCount: 7, anchorEpisode: 3 }),
      finished({ episode: 10 }),
    );
    expect(release).toMatchObject({ status: "caught-up" });
    expect(release?.episode).toBeUndefined();
  });

  test("caught up with an episode scheduled reports it as upcoming", () => {
    const release = continueReleaseFromProjection(
      projection({
        nextAiringSeason: 1,
        nextAiringEpisode: 11,
        nextAiringAt: "2026-12-01T00:00:00.000Z",
      }),
      finished({ episode: 10 }),
    );
    expect(release).toEqual({
      status: "upcoming",
      releaseAt: "2026-12-01T00:00:00.000Z",
      season: 1,
      episode: 11,
    });
  });

  test("a later aired season gives no next episode: this season's length is unknown", () => {
    const release = continueReleaseFromProjection(
      projection({ latestAiredSeason: 3, latestAiredEpisode: 8 }),
      finished({ season: 1, episode: 10 }),
    );
    expect(release).toMatchObject({ status: "caught-up" });
    expect(release?.episode).toBeUndefined();
  });

  test("anime numbered by absolute episode advances on the absolute number", () => {
    const release = continueReleaseFromProjection(
      projection({ mediaKind: "anime", latestAiredSeason: undefined, latestAiredEpisode: 24 }),
      finished({ mediaKind: "anime", season: undefined, episode: undefined, absoluteEpisode: 12 }),
    );
    expect(release).toMatchObject({ status: "released", season: 1, episode: 13 });
  });

  test("an unfinished row and a movie keep the projection's own answer", () => {
    const fresh = projection({ status: "new-episodes", newEpisodeCount: 3, anchorEpisode: 5 });
    expect(
      continueReleaseFromProjection(fresh, finished({ completed: false, positionSeconds: 60 })),
    ).toMatchObject({ status: "released", episode: 6 });
    expect(
      continueReleaseFromProjection(fresh, finished({ mediaKind: "movie", season: undefined })),
    ).toMatchObject({ status: "released", episode: 6 });
  });

  test("no projection, no release", () => {
    expect(continueReleaseFromProjection(undefined, finished())).toBeNull();
  });
});
