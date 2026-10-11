import { afterAll, expect, test } from "bun:test";

import { externalIdsToAliases, HistoryTitleAliasRepository } from "../src/index";
import type { KunaiDatabase } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterAll(() => {
  stores.cleanup();
});

test("HistoryTitleAliasRepository: any alias resolves to the canonical title id", () => {
  const db = migratedDataDb();
  const repo = new HistoryTitleAliasRepository(db);

  repo.upsertAliases("1535", [
    { ns: "anilist", id: "1535" },
    { ns: "mal", id: "1535" },
    { ns: "tmdb", id: "13916" },
    { ns: "imdb", id: "tt0877057" },
    { ns: "provider:allanime", id: "bxCKTnota29uSRnZw" },
  ]);

  expect(repo.lookupTitleId("tmdb", "13916")).toBe("1535");
  expect(repo.lookupTitleId("anilist", "1535")).toBe("1535");
  expect(repo.lookupTitleId("provider:allanime", "bxCKTnota29uSRnZw")).toBe("1535");
  expect(repo.lookupTitleId("tmdb", "99999")).toBeUndefined();
  expect(repo.listByTitleId("1535")).toHaveLength(5);
});

test("HistoryTitleAliasRepository: re-upserting an alias repoints it to the new title id", () => {
  const db = migratedDataDb();
  const repo = new HistoryTitleAliasRepository(db);

  repo.upsertAliases("tmdb:13916", [{ ns: "tmdb", id: "13916" }]);
  repo.upsertAliases("1535", [
    { ns: "tmdb", id: "13916" },
    { ns: "anilist", id: "1535" },
  ]);

  expect(repo.lookupTitleId("tmdb", "13916")).toBe("1535");
  expect(repo.listByTitleId("tmdb:13916")).toHaveLength(0);
});

test("HistoryTitleAliasRepository: reassignTitleId moves every alias during a merge", () => {
  const db = migratedDataDb();
  const repo = new HistoryTitleAliasRepository(db);

  repo.upsertAliases("tmdb:13916", [
    { ns: "tmdb", id: "13916" },
    { ns: "imdb", id: "tt0877057" },
  ]);
  repo.reassignTitleId("tmdb:13916", "1535");

  expect(repo.lookupTitleId("tmdb", "13916")).toBe("1535");
  expect(repo.lookupTitleId("imdb", "tt0877057")).toBe("1535");
});

test("externalIdsToAliases maps the full external id bag including provider natives", () => {
  const aliases = externalIdsToAliases({
    anilistId: "1535",
    malId: "1535",
    tmdbId: "13916",
    imdbId: "tt0877057",
    youtubeId: "abc123",
    providerNativeIds: { allanime: "bxCKTnota29uSRnZw" },
  });

  expect(aliases).toContainEqual({ ns: "anilist", id: "1535" });
  expect(aliases).toContainEqual({ ns: "mal", id: "1535" });
  expect(aliases).toContainEqual({ ns: "tmdb", id: "13916" });
  expect(aliases).toContainEqual({ ns: "imdb", id: "tt0877057" });
  expect(aliases).toContainEqual({ ns: "youtube", id: "abc123" });
  expect(aliases).toContainEqual({ ns: "provider:allanime", id: "bxCKTnota29uSRnZw" });
  expect(externalIdsToAliases(undefined)).toEqual([]);
});

test("externalIdsToAliases indexes youtube channel and playlist ids", () => {
  const aliases = externalIdsToAliases({
    youtubeId: "vid1",
    youtubeChannelId: "UCchannel",
    youtubePlaylistId: "PLlist",
  });
  expect(aliases).toContainEqual({ ns: "youtube", id: "vid1" });
  expect(aliases).toContainEqual({ ns: "youtube-channel", id: "UCchannel" });
  expect(aliases).toContainEqual({ ns: "youtube-playlist", id: "PLlist" });
});

test("HistoryRepository.upsertProgress writes alias rows for every known external id", async () => {
  const { HistoryRepository } = await import("../src/index");
  const db = migratedDataDb();
  const history = new HistoryRepository(db);
  const aliases = new HistoryTitleAliasRepository(db);

  history.upsertProgress({
    title: {
      id: "1535",
      kind: "anime",
      title: "Death Note",
      externalIds: { anilistId: "1535", malId: "1535", tmdbId: "13916" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 60,
    durationSeconds: 1420,
  });

  expect(aliases.lookupTitleId("tmdb", "13916")).toBe("1535");
  expect(aliases.lookupTitleId("mal", "1535")).toBe("1535");
  expect(aliases.lookupTitleId("anilist", "1535")).toBe("1535");
});

test("HistoryTitleAliasRepository bulk lookups match single lookups", () => {
  const db = migratedDataDb();
  const repo = new HistoryTitleAliasRepository(db);

  repo.upsertAliases("canonical", [
    { ns: "tmdb", id: "111" },
    { ns: "anilist", id: "222" },
  ]);

  const pairs = [
    ["tmdb", "111"],
    ["anilist", "222"],
    ["tmdb", "missing"],
  ] as const;
  const bulk = repo.lookupTitleIds(pairs.map(([ns, id]) => [ns, id] as const));
  pairs.forEach(([ns, id], index) => {
    expect(bulk.get(index)).toBe(repo.lookupTitleId(ns, id));
  });
  expect(bulk.get(0)).toBe("canonical");
  expect(bulk.has(2)).toBe(false);
  expect(repo.lookupTitleIds([]).size).toBe(0);

  const byAlias = repo.lookupTitleIdsByAliasId(["111", "222", "missing", "  "]);
  expect(byAlias.get("111")).toBe(repo.lookupTitleIdByAliasId("111"));
  expect(byAlias.get("222")).toBe("canonical");
  expect(byAlias.has("missing")).toBe(false);
});

test("getLatestForTitleIdentity prefers the canonical id over recency", async () => {
  const { HistoryRepository } = await import("../src/index");
  const db = migratedDataDb();
  const history = new HistoryRepository(db);
  const seed = (id: string, updatedAt: string) =>
    history.upsertProgress({
      title: { id, kind: "anime", title: `Title ${id}` },
      episode: { season: 1, episode: 1 },
      positionSeconds: 60,
      durationSeconds: 1420,
      updatedAt,
    });

  // Alias target is newer, canonical is older: the old per-id loop returned
  // the canonical row first, and the batched query must decide identically.
  seed("1535", "2026-01-01T00:00:00.000Z");
  seed("legacy-anime", "2026-06-01T00:00:00.000Z");
  new HistoryTitleAliasRepository(db).upsertAliases("legacy-anime", [{ ns: "tmdb", id: "13916" }]);

  const lookup = {
    id: "1535",
    kind: "anime" as const,
    title: "Death Note",
    externalIds: { tmdbId: "13916" },
  };
  const latestLookup = { id: "1535", kind: "anime" as const, externalIds: { tmdbId: "13916" } };
  expect(history.getLatestForTitleIdentity(latestLookup)?.titleId).toBe("1535");

  // Exact-episode variant resolves through the same candidate order.
  expect(history.getProgressForTitleIdentity(lookup, { season: 1, episode: 1 })?.titleId).toBe(
    "1535",
  );

  // …while a lookup with no canonical rows still falls through to the alias.
  expect(
    history.getLatestForTitleIdentity({
      id: "ghost",
      kind: "anime",
      externalIds: { tmdbId: "13916" },
    })?.titleId,
  ).toBe("legacy-anime");
});

function migratedDataDb(): KunaiDatabase {
  const db = stores.store("title-aliases", "data");
  return db;
}
