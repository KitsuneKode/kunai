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
