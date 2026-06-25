import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openKunaiDatabase,
  runMigrations,
  YoutubeMetadataCacheRepository,
  type KunaiDatabase,
} from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("YoutubeMetadataCacheRepository respects TTL and purge helpers", () => {
  const db = openCacheDb();
  const repo = new YoutubeMetadataCacheRepository(db);

  repo.upsert({
    videoId: "expired",
    payloadJson: "{}",
    source: "yt-dlp",
    fetchedAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-05-16T00:00:00.000Z",
  });
  repo.upsert({
    videoId: "fresh",
    payloadJson: '{"title":"ok"}',
    source: "yt-dlp",
    fetchedAt: "2026-05-17T00:00:00.000Z",
    expiresAt: "2026-05-18T00:00:00.000Z",
  });

  expect(repo.get("expired", "2026-05-17T00:00:00.000Z")).toBeNull();
  expect(repo.get("fresh", "2026-05-17T00:00:00.000Z")?.payloadJson).toBe('{"title":"ok"}');

  expect(repo.pruneExpired("2026-05-17T00:00:00.000Z")).toBe(1);
  expect(repo.get("expired", "2026-05-17T00:00:00.000Z")).toBeNull();
  expect(repo.purgeAll()).toBe(1);
  expect(repo.get("fresh", "2026-05-17T00:00:00.000Z")).toBeNull();

  db.close();
});

function openCacheDb(): KunaiDatabase {
  const dir = mkdtempSync(join(tmpdir(), "kunai-youtube-metadata-cache-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "cache.sqlite"));
  runMigrations(db, "cache");
  return db;
}
