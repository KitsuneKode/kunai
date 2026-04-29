import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";

import {
  HistoryRepository,
  openKunaiDatabase,
  runMigrations,
  StreamCacheRepository,
} from "@kunai/storage";

import type { StreamInfo } from "@/domain/types";
import { SqliteCacheStoreImpl } from "@/services/persistence/SqliteCacheStoreImpl";
import { SqliteHistoryStoreImpl } from "@/services/persistence/SqliteHistoryStoreImpl";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SqliteHistoryStoreImpl", () => {
  test("persists and returns latest title progress", async () => {
    const db = openTempDb("history.sqlite");
    runMigrations(db, "data");
    const store = new SqliteHistoryStoreImpl(new HistoryRepository(db));

    await store.save("tmdb:1", {
      title: "Example",
      type: "series",
      season: 1,
      episode: 2,
      timestamp: 120,
      duration: 1200,
      completed: false,
      provider: "vidking",
      watchedAt: "2026-04-29T00:00:00.000Z",
    });

    await expect(store.get("tmdb:1")).resolves.toMatchObject({
      title: "Example",
      season: 1,
      episode: 2,
      timestamp: 120,
      provider: "vidking",
    });

    const all = await store.getAll();
    expect(all["tmdb:1"]?.episode).toBe(2);
    expect(all["tmdb:1"]?.completed).toBe(false);

    await store.save("tmdb:1", {
      title: "Example",
      type: "series",
      season: 1,
      episode: 3,
      timestamp: 1200,
      duration: 1200,
      completed: true,
      provider: "vidking",
      watchedAt: "2026-04-30T00:00:00.000Z",
    });

    await expect(store.listByTitle("tmdb:1")).resolves.toMatchObject([
      { episode: 2, completed: false },
      { episode: 3, completed: true },
    ]);

    db.close();
  });
});

describe("SqliteCacheStoreImpl", () => {
  test("round trips full StreamInfo metadata", async () => {
    const db = openTempDb("cache.sqlite");
    runMigrations(db, "cache");
    const store = new SqliteCacheStoreImpl(new StreamCacheRepository(db));
    const stream: StreamInfo = {
      url: "https://cdn.example/master.m3u8",
      headers: { Referer: "https://vidking.net" },
      subtitle: "https://cdn.example/sub.vtt",
      subtitleSource: "wyzie",
      subtitleEvidence: { reason: "wyzie-selected", wyzieSearchObserved: true },
      timestamp: 123,
    };

    await store.set("https://embed.example/watch/1", stream);

    await expect(store.get("https://embed.example/watch/1")).resolves.toMatchObject({
      url: stream.url,
      subtitle: stream.subtitle,
      subtitleSource: "wyzie",
      subtitleEvidence: { reason: "wyzie-selected" },
    });

    db.close();
  });

  test("cache write failures are non-fatal", async () => {
    const db = openTempDb("cache.sqlite");
    runMigrations(db, "cache");
    const store = new SqliteCacheStoreImpl(new StreamCacheRepository(db));

    await expect(
      store.set("https://embed.example/watch/1", {
        url: "not a url",
        headers: {},
        timestamp: 123,
      }),
    ).resolves.toBeUndefined();

    db.close();
  });
});

function openTempDb(fileName: string) {
  const dir = mkdtempSync(join(tmpdir(), "kunai-cli-storage-"));
  tempDirs.push(dir);
  return openKunaiDatabase(join(dir, fileName));
}
