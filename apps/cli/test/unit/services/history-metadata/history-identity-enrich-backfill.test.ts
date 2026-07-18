import { expect, test } from "bun:test";

import type { CatalogIdentityEnrichResult } from "@/services/catalog/CatalogIdentityService";
import { runHistoryIdentityEnrichBackfill } from "@/services/history-metadata/HistoryIdentityEnrichBackfill";
import {
  HistoryRepository,
  HistoryTitleAliasRepository,
  openKunaiDatabase,
  runMigrations,
} from "@kunai/storage";

function fakeIdentity(byKey: Record<string, CatalogIdentityEnrichResult>, calls: string[] = []) {
  return {
    calls,
    enrich: async (input: { id: string }) => {
      calls.push(input.id);
      return (
        byKey[input.id] ?? {
          externalIds: undefined,
          graph: { confidence: "low" as const, source: "arm" as const },
        }
      );
    },
  };
}

test("backfill enriches split anime/series history into one AniList unit", async () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);

  // Watched via AllAnime/AniList lane: AniList unit, no TMDB id.
  repo.upsertProgress({
    title: {
      id: "1535",
      kind: "anime",
      title: "Death Note",
      externalIds: { anilistId: "1535" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 600,
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
  // Watched via TMDB lane: tmdb unit, no anime ids.
  repo.upsertProgress({
    title: {
      id: "tmdb:13916",
      kind: "series",
      title: "Death Note",
      externalIds: { tmdbId: "13916" },
    },
    episode: { season: 1, episode: 2 },
    positionSeconds: 300,
    updatedAt: "2026-06-02T00:00:00.000Z",
  });

  const fullBag = {
    anilistId: "1535",
    malId: "1535",
    tmdbId: "13916",
    imdbId: "tt0877057",
  };
  const identity = fakeIdentity({
    "1535": { externalIds: fullBag, graph: { ...fullBag, confidence: "high", source: "arm" } },
    "tmdb:13916": {
      externalIds: fullBag,
      graph: { ...fullBag, confidence: "high", source: "arm" },
    },
  });

  const stats = await runHistoryIdentityEnrichBackfill({ db, identity });

  expect(stats.enriched).toBeGreaterThan(0);
  const units = new Set(repo.listAllProgress().map((row) => row.titleId));
  expect(units).toEqual(new Set(["1535"]));

  const aliases = new HistoryTitleAliasRepository(db);
  expect(aliases.lookupTitleId("tmdb", "13916")).toBe("1535");

  db.close();
});

test("backfill respects the budget and never rewrites on low confidence", async () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);

  for (let index = 0; index < 5; index += 1) {
    repo.upsertProgress({
      title: {
        id: String(1000 + index),
        kind: "anime",
        title: `Show ${index}`,
        externalIds: { anilistId: String(1000 + index) },
      },
      episode: { season: 1, episode: 1 },
      positionSeconds: 60,
    });
  }

  const identity = fakeIdentity({});
  const stats = await runHistoryIdentityEnrichBackfill({ db, identity, budget: 2 });

  expect(identity.calls).toHaveLength(2);
  expect(stats.enriched).toBe(0);
  expect(new Set(repo.listAllProgress().map((row) => row.titleId)).size).toBe(5);

  db.close();
});

test("backfill treats a no-op enrichment as not enriched so repeat startups stay cheap", async () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);

  // Barakamon-shape: anime ids present, TMDB lane missing — and the crosswalk
  // legitimately has no TMDB mapping, so enrichment can never add anything.
  repo.upsertProgress({
    title: {
      id: "20782",
      kind: "anime",
      title: "Barakamon",
      externalIds: { anilistId: "20782", malId: "25045" },
    },
    episode: { season: 1, episode: 12 },
    positionSeconds: 600,
  });

  const sameBag = { anilistId: "20782", malId: "25045" };
  const identity = fakeIdentity({
    "20782": {
      externalIds: sameBag,
      graph: { ...sameBag, confidence: "high", source: "arm" },
    },
  });

  const before = repo.listAllProgress();
  const stats = await runHistoryIdentityEnrichBackfill({ db, identity });

  // High confidence but nothing new: must not count as enriched (and must not
  // trigger the whole-history consolidator on every startup).
  expect(stats.enriched).toBe(0);
  expect(stats.skippedNoNewIds).toBe(1);
  expect(repo.listAllProgress()).toEqual(before);

  db.close();
});

test("backfill skips titles that already carry both lane ids", async () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);

  repo.upsertProgress({
    title: {
      id: "1535",
      kind: "anime",
      title: "Death Note",
      externalIds: { anilistId: "1535", tmdbId: "13916", malId: "1535" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 60,
  });

  const identity = fakeIdentity({});
  const stats = await runHistoryIdentityEnrichBackfill({ db, identity });

  expect(identity.calls).toHaveLength(0);
  expect(stats.skippedComplete).toBe(1);

  db.close();
});
