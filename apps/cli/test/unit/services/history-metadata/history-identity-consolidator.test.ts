import { expect, test } from "bun:test";

import { runHistoryIdentityConsolidator } from "@/services/history-metadata/HistoryIdentityConsolidator";
import {
  HistoryRepository,
  HistoryTitleAliasRepository,
  openKunaiDatabase,
  runMigrations,
} from "@kunai/storage";

function seedRepo(repo: HistoryRepository): void {
  repo.upsertProgress({
    title: {
      id: "bxCKTopaque",
      kind: "anime",
      title: "Hozuki",
      externalIds: { anilistId: "20431" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 100,
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
}

test("consolidator retitles opaque rows with anilist proof", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  seedRepo(repo);

  const stats = runHistoryIdentityConsolidator(db);
  expect(stats.retitled).toBe(1);
  expect(repo.getLatestForTitle("20431")?.titleId).toBe("20431");
  expect(repo.getLatestForTitle("bxCKTopaque")).toBeUndefined();
});

test("consolidator skips rows without catalog proof", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  repo.upsertProgress({
    title: { id: "opaque-only", kind: "anime", title: "Unknown" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 10,
    providerId: "allanime",
  });

  const stats = runHistoryIdentityConsolidator(db);
  expect(stats.skippedNoProof).toBe(1);
  expect(stats.retitled).toBe(0);
  expect(repo.getLatestForTitle("opaque-only")?.titleId).toBe("opaque-only");
});

test("consolidator merges forked rows that share the same anilist id", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  repo.upsertProgress({
    title: {
      id: "20431",
      kind: "anime",
      title: "Canonical",
      externalIds: { anilistId: "20431" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 50,
    updatedAt: "2026-06-02T00:00:00.000Z",
  });
  repo.upsertProgress({
    title: {
      id: "bxCKTopaque",
      kind: "anime",
      title: "Fork",
      externalIds: { anilistId: "20431" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 100,
    updatedAt: "2026-06-03T00:00:00.000Z",
  });

  const stats = runHistoryIdentityConsolidator(db);
  expect(stats.merged).toBe(1);
  expect(repo.listAllProgress()).toHaveLength(1);
  expect(repo.getLatestForTitle("20431")?.positionSeconds).toBe(100);
});

test("merging a forked row never moves the resume position backwards", () => {
  // The existing merge test above happens to have the newer row also be the
  // further one, so it passed either way. This is the case that lost data: the
  // survivor is chosen by `updated_at`, and the row touched most recently is
  // the one that had barely been started.
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  repo.upsertProgress({
    title: { id: "20431", kind: "anime", title: "Canonical", externalIds: { anilistId: "20431" } },
    episode: { season: 1, episode: 1 },
    positionSeconds: 100,
    updatedAt: "2026-06-02T00:00:00.000Z",
  });
  repo.upsertProgress({
    title: {
      id: "bxCKTopaque",
      kind: "anime",
      title: "Fork",
      externalIds: { anilistId: "20431" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 10,
    updatedAt: "2026-06-03T00:00:00.000Z",
  });

  const stats = runHistoryIdentityConsolidator(db);

  expect(stats.merged).toBe(1);
  expect(repo.listAllProgress()).toHaveLength(1);
  expect(repo.getLatestForTitle("20431")?.positionSeconds).toBe(100);
});

test("merging a forked row keeps a completion the surviving row does not have", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  repo.upsertProgress({
    title: { id: "20431", kind: "anime", title: "Canonical", externalIds: { anilistId: "20431" } },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_400,
    durationSeconds: 1_440,
    completed: true,
    updatedAt: "2026-06-02T00:00:00.000Z",
  });
  repo.upsertProgress({
    title: {
      id: "bxCKTopaque",
      kind: "anime",
      title: "Fork",
      externalIds: { anilistId: "20431" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 30,
    updatedAt: "2026-06-03T00:00:00.000Z",
  });

  expect(runHistoryIdentityConsolidator(db).merged).toBe(1);

  const merged = repo.getLatestForTitle("20431");
  expect(merged?.completed).toBe(true);
  // Finished, so it offers a replay rather than a seek into the credits.
  expect(merged?.positionSeconds).toBe(0);
  expect(merged?.durationSeconds).toBe(1_440);
});

test("consolidator moves anime-class series rows onto their AniList unit", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  repo.upsertProgress({
    title: {
      id: "tmdb:13916",
      kind: "series",
      title: "Death Note",
      externalIds: { tmdbId: "13916", anilistId: "1535" },
    },
    episode: { season: 1, episode: 5 },
    positionSeconds: 300,
    updatedAt: "2026-06-02T00:00:00.000Z",
  });

  const stats = runHistoryIdentityConsolidator(db);
  expect(stats.retitled).toBe(1);
  expect(repo.getLatestForTitle("1535")?.titleId).toBe("1535");
  expect(repo.getLatestForTitle("tmdb:13916")).toBeUndefined();
});

test("consolidator leaves western series on their tmdb unit", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  repo.upsertProgress({
    title: {
      id: "tmdb:1396",
      kind: "series",
      title: "Breaking Bad",
      externalIds: { tmdbId: "1396", imdbId: "tt0903747" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 10,
  });

  const stats = runHistoryIdentityConsolidator(db);
  expect(stats.retitled).toBe(0);
  expect(repo.getLatestForTitle("tmdb:1396")?.titleId).toBe("tmdb:1396");
});

test("consolidator indexes aliases and reassigns them on retitle", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  const aliases = new HistoryTitleAliasRepository(db);
  repo.upsertProgress({
    title: {
      id: "tmdb:13916",
      kind: "series",
      title: "Death Note",
      externalIds: { tmdbId: "13916", anilistId: "1535", imdbId: "tt0877057" },
    },
    episode: { season: 1, episode: 5 },
    positionSeconds: 300,
  });

  runHistoryIdentityConsolidator(db);
  expect(aliases.lookupTitleId("tmdb", "13916")).toBe("1535");
  expect(aliases.lookupTitleId("imdb", "tt0877057")).toBe("1535");
  expect(aliases.lookupTitleId("anilist", "1535")).toBe("1535");
});

test("consolidator dry-run does not mutate rows", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  seedRepo(repo);

  runHistoryIdentityConsolidator(db, { dryRun: true });
  expect(repo.getLatestForTitle("bxCKTopaque")?.titleId).toBe("bxCKTopaque");
});
