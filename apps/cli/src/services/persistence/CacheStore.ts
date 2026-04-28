// =============================================================================
// Cache Store
//
// Manages stream URL caching.
// =============================================================================

import type { StreamInfo } from "../../domain/types";

export interface CacheEntry {
  stream: StreamInfo;
  cachedAt: number;
}

export interface CacheStore {
  get(url: string): Promise<StreamInfo | null>;
  set(url: string, stream: StreamInfo): Promise<void>;
  delete(url: string): Promise<void>;
  clear(): Promise<void>;
  prune(): Promise<void>;

  // TTL in milliseconds
  readonly ttl: number;
}

// Default TTL: 15 minutes (matches CDN token expiration)
export const DEFAULT_CACHE_TTL = 15 * 60 * 1000;

export function isExpired(entry: CacheEntry, ttl = DEFAULT_CACHE_TTL): boolean {
  return Date.now() - entry.cachedAt > ttl;
}
