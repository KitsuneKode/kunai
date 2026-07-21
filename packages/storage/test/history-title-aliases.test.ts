import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  externalIdsToAliases,
  HistoryTitleAliasRepository,
  openKunaiDatabase,
  runMigrations,
} from "../src/index";
import type { KunaiDatabase } from "../src/index";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
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

  db.close();
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

  db.close();
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

  db.close();
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

  db.close();
});

function migratedDataDb(): KunaiDatabase {
  const dir = mkdtempSync(join(tmpdir(), "kunai-title-aliases-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  return db;
}
