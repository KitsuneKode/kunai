import { expect, test } from "bun:test";

import { runHistoryIdentityConsolidator } from "@/services/history-metadata/HistoryIdentityConsolidator";
import { HistoryRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

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

test("consolidator dry-run does not mutate rows", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  seedRepo(repo);

  runHistoryIdentityConsolidator(db, { dryRun: true });
  expect(repo.getLatestForTitle("bxCKTopaque")?.titleId).toBe("bxCKTopaque");
});
