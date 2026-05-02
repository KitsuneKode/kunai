import { createHash } from "node:crypto";

import type { StreamInfo } from "@/domain/types";
import { StreamCacheRepository } from "@kunai/storage";
import type { StreamCandidate } from "@kunai/types";

import type { CacheStore } from "./CacheStore";
import { DEFAULT_CACHE_TTL } from "./CacheStore";

const STREAM_INFO_METADATA_KEY = "kunaiStreamInfo";

export class SqliteCacheStoreImpl implements CacheStore {
  readonly ttl = DEFAULT_CACHE_TTL;

  constructor(private readonly repository: StreamCacheRepository) {}

  async get(url: string): Promise<StreamInfo | null> {
    try {
      const entry = this.repository.get(toCacheKey(url));
      const streamInfo = entry?.stream.metadata?.[STREAM_INFO_METADATA_KEY];
      return isStreamInfo(streamInfo) ? streamInfo : null;
    } catch {
      return null;
    }
  }

  async set(url: string, stream: StreamInfo): Promise<void> {
    try {
      const now = Date.now();
      const expiresAt = new Date(now + this.ttl).toISOString();

      this.repository.set(
        toCacheKey(url),
        toStreamCandidate(url, stream, now),
        expiresAt,
        new Date(now).toISOString(),
      );
    } catch {
      // Cache persistence is a performance feature; playback must keep going if it fails.
    }
  }

  async delete(url: string): Promise<void> {
    this.repository.delete(toCacheKey(url));
  }

  async clear(): Promise<void> {
    try {
      this.repository.clear();
    } catch {}
  }

  async prune(): Promise<void> {
    try {
      this.repository.pruneExpired();
    } catch {}
  }
}

function toCacheKey(url: string): string {
  return `cli-stream:${createHash("sha256").update(url).digest("hex")}`;
}

function toStreamCandidate(
  cacheSourceUrl: string,
  stream: StreamInfo,
  now: number,
): StreamCandidate {
  return {
    id: toCacheKey(cacheSourceUrl),
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
      keyParts: [cacheSourceUrl],
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
