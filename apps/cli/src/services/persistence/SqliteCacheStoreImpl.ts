import { createHash } from "node:crypto";

import type { StreamInfo } from "@/domain/types";
import { dbgErr } from "@/logger";
import { StreamCacheRepository } from "@kunai/storage";
import type { StreamCandidate } from "@kunai/types";

import type { CacheStore } from "./CacheStore";
import { DEFAULT_CACHE_TTL } from "./CacheStore";

const STREAM_INFO_METADATA_KEY = "kunaiStreamInfo";

export class SqliteCacheStoreImpl implements CacheStore {
  readonly ttl = DEFAULT_CACHE_TTL;

  constructor(private readonly repository: StreamCacheRepository) {}

  async get(key: string): Promise<StreamInfo | null> {
    try {
      const entry = this.repository.get(toStorageKey(key));
      const streamInfo = entry?.stream.metadata?.[STREAM_INFO_METADATA_KEY];
      return isStreamInfo(streamInfo) ? streamInfo : null;
    } catch (error) {
      dbgErr("cache", "stream-cache-get-failed", error);
      return null;
    }
  }

  async set(key: string, stream: StreamInfo): Promise<void> {
    try {
      const now = Date.now();
      const expiresAt = new Date(now + this.ttl).toISOString();

      this.repository.set(
        toStorageKey(key),
        toStreamCandidate(key, stream, now),
        expiresAt,
        new Date(now).toISOString(),
      );
    } catch (error) {
      // Cache persistence is a performance feature; playback must keep going if it fails.
      dbgErr("cache", "stream-cache-set-failed", error);
    }
  }

  async delete(key: string): Promise<void> {
    this.repository.delete(toStorageKey(key));
  }

  async clear(): Promise<void> {
    try {
      this.repository.clear();
    } catch (error) {
      dbgErr("cache", "stream-cache-clear-failed", error);
    }
  }

  async prune(): Promise<void> {
    try {
      this.repository.pruneExpired();
    } catch (error) {
      dbgErr("cache", "stream-cache-prune-failed", error);
    }
  }
}

// Hash the opaque resolve key into a stable storage key for the row id.
function toStorageKey(key: string): string {
  return `cli-stream:${createHash("sha256").update(key).digest("hex")}`;
}

function toStreamCandidate(resolveKey: string, stream: StreamInfo, now: number): StreamCandidate {
  return {
    id: toStorageKey(resolveKey),
    providerId: "cli-cache",
    url: stream.url,
    protocol: stream.url.includes(".m3u8") ? "hls" : "unknown",
    container: stream.url.includes(".m3u8") ? "m3u8" : "unknown",
    headers: stream.headers,
    confidence: 1,
    cachePolicy: {
      ttlClass: "stream-manifest",
      ttlMs: DEFAULT_CACHE_TTL,
      scope: "local",
      keyParts: [resolveKey],
    },
    metadata: {
      [STREAM_INFO_METADATA_KEY]: {
        ...stream,
        timestamp: stream.timestamp || now,
      },
    },
  };
}

function isStreamInfo(value: unknown): value is StreamInfo {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<StreamInfo>;
  return typeof candidate.url === "string" && typeof candidate.headers === "object";
}
