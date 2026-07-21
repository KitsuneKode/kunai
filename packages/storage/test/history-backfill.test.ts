import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HistoryRepository, openKunaiDatabase, runMigrations } from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repo(): HistoryRepository {
  const dir = mkdtempSync(join(tmpdir(), "kunai-history-backfill-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  return new HistoryRepository(db);
}

function seedTwoEpisodes(r: HistoryRepository): void {
  for (const episode of [1, 2]) {
    r.upsertProgress({
      title: { id: "opaque-1", kind: "anime", title: "Barakamon" },
      episode: { season: 1, episode },
      positionSeconds: 1373,
      durationSeconds: 1373,
      completed: true,
    });
  }
}

test("backfillTitleMetadata fills a missing poster across every row of a title", () => {
  const r = repo();
  seedTwoEpisodes(r);
  expect(r.getLatestForTitle("opaque-1")?.posterUrl).toBeUndefined();

  r.backfillTitleMetadata("opaque-1", { posterUrl: "https://img/barakamon.jpg" });

  for (const row of r.listByTitle("opaque-1")) {
    expect(row.posterUrl).toBe("https://img/barakamon.jpg");
  }
});

test("backfillTitleMetadata fills missing external ids", () => {
  const r = repo();
  seedTwoEpisodes(r);
  expect(r.getLatestForTitle("opaque-1")?.externalIds).toBeUndefined();

  r.backfillTitleMetadata("opaque-1", { externalIds: { anilistId: "103223" } });

  expect(r.getLatestForTitle("opaque-1")?.externalIds).toEqual({ anilistId: "103223" });
});

test("backfillTitleMetadata reports whether any row actually changed", () => {
  const r = repo();
  seedTwoEpisodes(r);

  // First write adds new ids → changed.
  expect(r.backfillTitleMetadata("opaque-1", { externalIds: { anilistId: "103223" } })).toBe(true);

  // Same bag again adds nothing → unchanged.
  expect(r.backfillTitleMetadata("opaque-1", { externalIds: { anilistId: "103223" } })).toBe(false);

  // A bag that only repeats existing ids (with undefined lane ids present) is
  // still a no-op — undefined values must not count as new information.
  expect(
    r.backfillTitleMetadata("opaque-1", {
      externalIds: { anilistId: "103223", tmdbId: undefined, imdbId: undefined },
    }),
  ).toBe(false);

  // A genuinely new lane id → changed again.
  expect(
    r.backfillTitleMetadata("opaque-1", { externalIds: { anilistId: "103223", tmdbId: "61054" } }),
  ).toBe(true);
});

test("backfillTitleMetadata does NOT clobber an existing poster", () => {
  const r = repo();
  r.upsertProgress({
    title: { id: "opaque-1", kind: "anime", title: "Barakamon" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 10,
    posterUrl: "https://img/original.jpg",
  });

  r.backfillTitleMetadata("opaque-1", { posterUrl: "https://img/replacement.jpg" });

  expect(r.getLatestForTitle("opaque-1")?.posterUrl).toBe("https://img/original.jpg");
});

test("upsertProgress persists canonical title id and provider native map", () => {
  const r = repo();
  r.upsertProgress({
    title: {
      id: "bxCKTnota29uSRnZw",
      kind: "anime",
      title: "Hozuki's Coolheadedness",
      externalIds: { anilistId: "20431" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 120,
    providerId: "allanime",
  });

  const row = r.getLatestForTitle("20431");
  expect(row?.titleId).toBe("20431");
  expect(row?.externalIds).toEqual({
    anilistId: "20431",
    providerNativeIds: { allanime: "bxCKTnota29uSRnZw" },
  });
});

test("getLatestForTitleIdentity finds canonical row when session id is opaque", () => {
  const r = repo();
  r.upsertProgress({
    title: {
      id: "bxCKTnota29uSRnZw",
      kind: "anime",
      title: "Hozuki's Coolheadedness",
      externalIds: { anilistId: "20431" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 120,
    providerId: "allanime",
  });

  const found = r.getLatestForTitleIdentity({
    id: "bxCKTnota29uSRnZw",
    kind: "anime",
    externalIds: { anilistId: "20431" },
  });

  expect(found?.titleId).toBe("20431");
  expect(found?.positionSeconds).toBe(120);
});

test("getLatestForTitleIdentity falls back to legacy opaque title_id", () => {
  const r = repo();
  r.upsertProgress({
    title: { id: "legacy-opaque", kind: "anime", title: "Legacy" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 42,
  });

  const found = r.getLatestForTitleIdentity({
    id: "legacy-opaque",
    kind: "anime",
  });

  expect(found?.positionSeconds).toBe(42);
});

test("backfillTitleMetadata merges provider native ids without clobbering catalog ids", () => {
  const r = repo();
  r.upsertProgress({
    title: {
      id: "20431",
      kind: "anime",
      title: "Hozuki's Coolheadedness",
      externalIds: { anilistId: "20431", providerNativeIds: { miruro: "20431" } },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 120,
    providerId: "miruro",
  });

  r.backfillTitleMetadata("20431", {
    externalIds: {
      anilistId: "99999",
      providerNativeIds: { allanime: "bxCKTnota29uSRnZw" },
    },
  });

  expect(r.getLatestForTitle("20431")?.externalIds).toEqual({
    anilistId: "20431",
    providerNativeIds: { miruro: "20431", allanime: "bxCKTnota29uSRnZw" },
  });
});

test("listByTitleIdentity finds bare TMDB id and tmdb: prefixed id as one unit", () => {
  const r = repo();
  r.upsertProgress({
    title: {
      id: "tmdb:13916",
      kind: "series",
      title: "Death Note",
      externalIds: { tmdbId: "13916" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 90,
  });

  const viaBare = r.listByTitleIdentity({
    id: "13916",
    kind: "series",
    title: "Death Note",
    externalIds: { tmdbId: "13916" },
  });
  const viaPrefixed = r.listByTitleIdentity({
    id: "tmdb:13916",
    kind: "series",
    title: "Death Note",
    externalIds: { tmdbId: "13916" },
  });

  expect(viaBare).toHaveLength(1);
  expect(viaPrefixed).toHaveLength(1);
  expect(viaBare[0]?.positionSeconds).toBe(90);
  expect(viaPrefixed[0]?.titleId).toBe("tmdb:13916");
});

test("listByTitleIdentity resolves opaque provider alias to canonical title rows", () => {
  const r = repo();
  r.upsertProgress({
    title: {
      id: "bxCKTnota29uSRnZw",
      kind: "anime",
      title: "Hozuki's Coolheadedness",
      externalIds: { anilistId: "20431" },
    },
    episode: { season: 1, episode: 2 },
    positionSeconds: 200,
    providerId: "allanime",
  });

  const rows = r.listByTitleIdentity({
    id: "bxCKTnota29uSRnZw",
    kind: "anime",
    title: "Hozuki's Coolheadedness",
    externalIds: {
      anilistId: "20431",
      providerNativeIds: { allanime: "bxCKTnota29uSRnZw" },
    },
  });

  expect(rows).toHaveLength(1);
  expect(rows[0]?.titleId).toBe("20431");
  expect(rows[0]?.episode).toBe(2);
});

test("getProgressForTitleIdentity returns exact S1E4 and never inherits S1E3", () => {
  const r = repo();
  const title = {
    id: "tmdb:100",
    kind: "series" as const,
    title: "Demo",
    externalIds: { tmdbId: "100" },
  };
  r.upsertProgress({
    title,
    episode: { season: 1, episode: 3 },
    positionSeconds: 400,
    durationSeconds: 1400,
    completed: false,
  });

  expect(r.getProgressForTitleIdentity(title, { season: 1, episode: 4 })).toBeUndefined();
  expect(r.getProgressForTitleIdentity(title, { season: 1, episode: 3 })?.positionSeconds).toBe(
    400,
  );
  // Title-level latest is allowed only when no episode is specified.
  expect(r.getProgressForTitleIdentity(title)?.positionSeconds).toBe(400);
});

test("getProgressForTitleIdentity keeps absolute E13 distinct from S2E1 without absolute identity", () => {
  const r = repo();
  const title = {
    id: "1535",
    kind: "anime" as const,
    title: "Death Note",
    externalIds: { anilistId: "1535" },
  };
  r.upsertProgress({
    title,
    episode: { absoluteEpisode: 13 },
    positionSeconds: 555,
    durationSeconds: 1400,
    completed: false,
  });

  expect(
    r.getProgressForTitleIdentity(title, { season: 2, episode: 1 })?.positionSeconds,
  ).toBeUndefined();
  expect(r.getProgressForTitleIdentity(title, { absoluteEpisode: 13 })?.positionSeconds).toBe(555);
});
