import { afterEach, expect, test } from "bun:test";

import {
  openKunaiDatabase,
  runMigrations,
  YoutubeMetadataCacheRepository,
  type KunaiDatabase,
} from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
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
});

function openCacheDb(): KunaiDatabase {
  const db = stores.store("youtube-metadata-cache", "cache");
  return db;
}
