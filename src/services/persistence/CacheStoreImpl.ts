// =============================================================================
// Cache Store Implementation
// =============================================================================

import type { CacheStore, CacheEntry } from "./CacheStore";
import type { StorageService } from "../../infra/storage/StorageService";
import { DEFAULT_CACHE_TTL, isExpired } from "./CacheStore";

const STORAGE_KEY = "stream_cache";

export class CacheStoreImpl implements CacheStore {
  ttl = DEFAULT_CACHE_TTL;
  
  constructor(private storage: StorageService) {}
  
  async get(url: string): Promise<import("../../domain/types").StreamInfo | null> {
    const all = await this.getAllEntries();
    const entry = all[url];
    
    if (!entry) return null;
    if (isExpired(entry, this.ttl)) {
      await this.delete(url);
      return null;
    }
    
    return entry.stream;
  }
  
  async set(url: string, stream: import("../../domain/types").StreamInfo): Promise<void> {
    const all = await this.getAllEntries();
    all[url] = { stream, cachedAt: Date.now() };
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
  
  private async getAllEntries(): Promise<Record<string, CacheEntry>> {
    return (await this.storage.read<Record<string, CacheEntry>>(STORAGE_KEY)) ?? {};
  }
}
