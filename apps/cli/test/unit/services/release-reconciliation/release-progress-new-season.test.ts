import { expect, test } from "bun:test";

import {
  openKunaiDatabase,
  ReleaseProgressCacheRepository,
  runMigrations,
  type ReleaseProgressProjection,
} from "@kunai/storage";

function makeRepo(): ReleaseProgressCacheRepository {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "cache");
  return new ReleaseProgressCacheRepository(db);
}

function projection(overrides: Partial<ReleaseProgressProjection> = {}): ReleaseProgressProjection {
  return {
    titleId: "tmdb:1",
    mediaKind: "series",
    source: "tmdb",
    title: "Example",
    anchorEpisode: 12,
    newEpisodeCount: 0,
    status: "caught-up",
    checkedAt: "2026-05-29T00:00:00.000Z",
    nextCheckAt: "2026-05-29T02:00:00.000Z",
    staleAfterAt: "2026-05-30T00:00:00.000Z",
    sourceFingerprint: "tmdb:1:1:12:-",
    errorCount: 0,
    ...overrides,
  };
}

test("newSeason signal round-trips through the release_progress_cache column", () => {
  const repo = makeRepo();
  repo.upsert(
    projection({ newSeason: { season: 2, latestAiredEpisode: 3, nextAiringEpisode: 4 } }),
  );
  const back = repo.getByTitleIds(["tmdb:1"]).get("tmdb:1");
  expect(back?.newSeason).toEqual({ season: 2, latestAiredEpisode: 3, nextAiringEpisode: 4 });
});

test("an AniList media-based newSeason round-trips too", () => {
  const repo = makeRepo();
  repo.upsert(projection({ titleId: "anilist:9", source: "anilist", newSeason: { mediaId: 222 } }));
  expect(repo.getByTitleIds(["anilist:9"]).get("anilist:9")?.newSeason).toEqual({ mediaId: 222 });
});

test("absent newSeason reads back as undefined", () => {
  const repo = makeRepo();
  repo.upsert(projection());
  expect(repo.getByTitleIds(["tmdb:1"]).get("tmdb:1")?.newSeason).toBeUndefined();
});
