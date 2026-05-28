// =============================================================================
// Cache Store
//
// Manages stream URL caching.
// =============================================================================

import { getDefaultTtlMs } from "@kunai/storage";

import type { StreamInfo } from "../../domain/types";

export interface CacheStore {
  get(url: string): Promise<StreamInfo | null>;
  set(url: string, stream: StreamInfo): Promise<void>;
  delete(url: string): Promise<void>;
  clear(): Promise<void>;
  prune(): Promise<void>;

  // TTL in milliseconds
  readonly ttl: number;
}

// Default TTL for stream URLs. Keep this tied to the shared storage policy so
// cache-store writes and source-inventory writes age out on the same contract.
export const DEFAULT_CACHE_TTL = getDefaultTtlMs("stream-manifest");
