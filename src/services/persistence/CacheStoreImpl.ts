// =============================================================================
// Cache Store Implementation
// =============================================================================

import type { StreamInfo } from "@/domain/types";
import type { StorageService } from "@/infra/storage/StorageService";

import type { CacheStore, CacheEntry } from "./CacheStore";
import { DEFAULT_CACHE_TTL, isExpired } from "./CacheStore";

const STORAGE_KEY = "cache";

type LegacyCacheEntry = StreamInfo & {
  timestamp?: number;
};

export class CacheStoreImpl implements CacheStore {
  ttl = DEFAULT_CACHE_TTL;

  constructor(private storage: StorageService) {}

  async get(url: string): Promise<StreamInfo | null> {
    const all = await this.getAllEntries();
    const entry = this.normalizeEntry(all[url]);

    if (!entry) return null;
    if (isExpired(entry, this.ttl)) {
      await this.delete(url);
      return null;
    }

    return entry.stream;
  }

  async set(url: string, stream: StreamInfo): Promise<void> {
    const all = await this.getAllEntries();
    const now = Date.now();
    all[url] = { ...stream, timestamp: now };
    await this.storage.write(STORAGE_KEY, all);
  }

  async delete(url: string): Promise<void> {
    const all = await this.getAllEntries();
    delete all[url];
    await this.storage.write(STORAGE_KEY, all);
  }

  async clear(): Promise<void> {
    await this.storage.delete(STORAGE_KEY);
  }

  private async getAllEntries(): Promise<Record<string, LegacyCacheEntry>> {
    return (await this.storage.read<Record<string, LegacyCacheEntry>>(STORAGE_KEY)) ?? {};
  }

  private normalizeEntry(entry: LegacyCacheEntry | CacheEntry | undefined): CacheEntry | null {
    if (!entry) return null;

    if ("stream" in entry && "cachedAt" in entry) {
      return entry;
    }

    const legacy = entry as LegacyCacheEntry;
    const cachedAt = legacy.timestamp ?? 0;
    return {
      stream: {
        url: legacy.url,
        headers: legacy.headers,
        subtitle: legacy.subtitle,
        subtitleList: legacy.subtitleList,
        subtitleSource: legacy.subtitleSource,
        subtitleEvidence: legacy.subtitleEvidence,
        title: legacy.title,
        timestamp: legacy.timestamp ?? 0,
      },
      cachedAt,
    };
  }
}
