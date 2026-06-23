import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StreamInfo } from "@/domain/types";
import { DEFAULT_CACHE_TTL } from "@/services/persistence/CacheStore";
import { SqliteCacheStoreImpl } from "@/services/persistence/SqliteCacheStoreImpl";
import {
  getDefaultTtlMs,
  openKunaiDatabase,
  runMigrations,
  StreamCacheRepository,
} from "@kunai/storage";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SqliteCacheStoreImpl", () => {
  test("uses the shared stream-manifest TTL policy", () => {
    expect(DEFAULT_CACHE_TTL).toBe(getDefaultTtlMs("stream-manifest"));
  });

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
