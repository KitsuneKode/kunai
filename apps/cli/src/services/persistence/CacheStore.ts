// =============================================================================
// Cache Store
//
// Resolved-stream cache: maps an opaque resolve key -> the playable StreamInfo.
//
// IMPORTANT: the `key` argument is NOT a media URL. Callers pass the
// manifest-driven resolve key from `buildApiStreamResolveCacheKey`
// (provider/media/title/season/episode/audio/subtitle/quality/source/stream),
// so the cache is already provider- and preference-aware. The implementation is
// free to hash the key for storage.
//
// This is a distinct layer from the source-INVENTORY cache (`SourceInventoryService`
// + `@kunai/storage` ttl.ts), which caches *which sources exist* for a title;
// this one caches *the resolved playable stream* for a chosen source. They are
// intentionally separate — do not merge them.
// =============================================================================

import { getDefaultTtlMs } from "@kunai/storage";

import type { StreamInfo } from "../../domain/types";

export interface CacheStore {
  get(key: string): Promise<StreamInfo | null>;
  set(key: string, stream: StreamInfo): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  prune(): Promise<void>;

  // TTL in milliseconds
  readonly ttl: number;
}

// Default TTL for stream URLs. Keep this tied to the shared storage policy so
// cache-store writes and source-inventory writes age out on the same contract.
export const DEFAULT_CACHE_TTL = getDefaultTtlMs("stream-manifest");
