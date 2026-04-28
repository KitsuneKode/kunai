import { describe, expect, test } from "bun:test";

import type { StreamInfo } from "@/domain/types";
import type { StorageService } from "@/infra/storage/StorageService";

import { CacheStoreImpl } from "@/services/persistence/CacheStoreImpl";

class MemoryStorage implements StorageService {
  private store = new Map<string, unknown>();

  async read<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T | undefined) ?? null;
  }

  async write<T>(key: string, data: T): Promise<void> {
    this.store.set(key, data);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}

const STREAM: StreamInfo = {
  url: "https://cdn.example/master.m3u8",
  headers: { Referer: "https://vidking.net" },
  subtitle: "https://cdn.example/sub.vtt",
  timestamp: Date.now(),
};

describe("CacheStoreImpl", () => {
  test("reads legacy cache entries from stream_cache.json shape", async () => {
    const storage = new MemoryStorage();
    const store = new CacheStoreImpl(storage);
    const cachedTimestamp = Date.now();
    await storage.write("cache", {
      "https://embed.example/watch/123": {
        ...STREAM,
        timestamp: cachedTimestamp,
      },
    });

    await expect(store.get("https://embed.example/watch/123")).resolves.toMatchObject({
      ...STREAM,
      timestamp: cachedTimestamp,
    });
  });

  test("writes cache entries in the legacy-compatible shape", async () => {
    const storage = new MemoryStorage();
    const store = new CacheStoreImpl(storage);

    await store.set("https://embed.example/watch/456", STREAM);

    const raw = await storage.read<Record<string, StreamInfo & { timestamp: number }>>("cache");
    expect(raw?.["https://embed.example/watch/456"]?.url).toBe(STREAM.url);
    expect(typeof raw?.["https://embed.example/watch/456"]?.timestamp).toBe("number");
  });
});
