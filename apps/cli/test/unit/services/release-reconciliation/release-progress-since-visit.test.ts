import { describe, expect, test } from "bun:test";

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

const NOW = "2026-06-10T12:00:00.000Z";
const SINCE = "2026-06-08T09:00:00.000Z";

function projection(overrides: Partial<ReleaseProgressProjection> = {}): ReleaseProgressProjection {
  return {
    titleId: "tmdb:1",
    mediaKind: "series",
    source: "tmdb",
    title: "Example",
    anchorEpisode: 2,
    newEpisodeCount: 3,
    status: "new-episodes",
    checkedAt: "2026-06-10T00:00:00.000Z",
    nextCheckAt: "2026-06-10T14:00:00.000Z",
    staleAfterAt: "2026-06-20T00:00:00.000Z",
    latestKnownReleaseAt: "2026-06-09T00:00:00.000Z",
    sourceFingerprint: "tmdb:1:1:2:-",
    errorCount: 0,
    ...overrides,
  };
}

describe("ReleaseProgressCacheRepository.listNewSince", () => {
  test("returns active new-episode projections released after the visit", () => {
    const repo = makeRepo();
    repo.upsert(projection());
    repo.upsert(
      projection({
        titleId: "anilist:9",
        source: "anilist",
        mediaKind: "anime",
        newEpisodeCount: 1,
      }),
    );
    const rows = repo.listNewSince(SINCE, NOW);
    expect(rows.map((row) => row.titleId).sort()).toEqual(["anilist:9", "tmdb:1"]);
  });

  test("drops releases at or before the visit — the strip counts only what arrived since", () => {
    const repo = makeRepo();
    repo.upsert(projection({ latestKnownReleaseAt: "2026-06-08T09:00:00.000Z" })); // == since
    repo.upsert(
      projection({ titleId: "tmdb:2", latestKnownReleaseAt: "2026-06-05T00:00:00.000Z" }),
    );
    repo.upsert(
      projection({ titleId: "tmdb:3", latestKnownReleaseAt: "2026-06-10T06:00:00.000Z" }),
    );
    expect(repo.listNewSince(SINCE, NOW).map((row) => row.titleId)).toEqual(["tmdb:3"]);
  });

  test("caught-up, upcoming, zero-count, and stale rows never count as new", () => {
    const repo = makeRepo();
    repo.upsert(projection({ titleId: "tmdb:1", status: "caught-up", newEpisodeCount: 3 }));
    repo.upsert(projection({ titleId: "tmdb:2", status: "upcoming", newEpisodeCount: 2 }));
    repo.upsert(projection({ titleId: "tmdb:3", newEpisodeCount: 0 }));
    repo.upsert(projection({ titleId: "tmdb:4", staleAfterAt: "2026-06-01T00:00:00.000Z" }));
    expect(repo.listNewSince(SINCE, NOW)).toHaveLength(0);
  });

  test("projections without a known release timestamp cannot claim 'since'", () => {
    const repo = makeRepo();
    repo.upsert(projection({ latestKnownReleaseAt: undefined }));
    expect(repo.listNewSince(SINCE, NOW)).toHaveLength(0);
  });
});
