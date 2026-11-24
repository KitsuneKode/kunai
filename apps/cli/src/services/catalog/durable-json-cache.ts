import { parseCachedSearchResults } from "@/services/catalog/cached-search-results";
import type {
  CatalogDurableCache,
  CatalogDurableEntry,
} from "@/services/catalog/CatalogDiscoveryService";
import type { TmdbDurableCache } from "@/services/catalog/tmdb-proxy";
import type { RecommendationCacheRepository } from "@kunai/storage";
import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
  type JsonObject,
  type JsonValue,
} from "@kunai/types";

/** How long a last-known-good trending list is kept for outages and cold starts. */
export const CATALOG_STALE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
/** How long a saved show or season response is kept for outages. */
export const TMDB_STALE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type DurableCacheRepository = Pick<RecommendationCacheRepository, "get" | "set">;

export type DurableJsonCache<T> = {
  read(key: string): { readonly cachedAt: number; readonly value: T } | null;
  write(key: string, cachedAt: number, value: T): void;
};

export type DurableJsonCacheOptions<T> = {
  /** Row-key prefix inside the shared recommendation cache table. */
  readonly prefix: string;
  /**
   * The stored answer from its row (`cachedAt` already checked), or null when
   * the row is not a usable answer — a shape that drifted, or one written by a
   * different build. A null is "no saved answer", never an error.
   */
  readonly parse: (record: JsonObject) => T | null;
  /** The fields stored beside `cachedAt`; null declines the write. */
  readonly encode: (value: T) => object | null;
  /**
   * Row expiry is the retention window, not the freshness TTL: freshness is
   * the caller's memory cache, and a row that expired at the freshness TTL
   * could never serve an outage (the repository deletes expired rows on read).
   */
  readonly retentionMs: number;
};

/**
 * Last-known-good answers in the cache database, one row per key in the
 * shared recommendation cache table, stored as `{ cachedAt, ...fields }`.
 *
 * Never throws: a cache that cannot be read or written degrades to "no last
 * good answer", it does not break the surface that asked.
 */
export function createDurableJsonCache<T>(
  repository: DurableCacheRepository,
  options: DurableJsonCacheOptions<T>,
): DurableJsonCache<T> {
  return {
    read(key) {
      try {
        const entry = repository.get(`${options.prefix}${key}`);
        if (!entry) return null;
        const parsed: JsonValue = JSON.parse(entry.payloadJson);
        if (!isJsonObject(parsed) || !isJsonNumber(parsed.cachedAt)) return null;
        const value = options.parse(parsed);
        return value === null ? null : { cachedAt: parsed.cachedAt, value };
      } catch {
        return null;
      }
    },
    write(key, cachedAt, value) {
      try {
        const fields = options.encode(value);
        if (!fields) return;
        repository.set(
          `${options.prefix}${key}`,
          JSON.stringify({ cachedAt, ...fields }),
          new Date(cachedAt + options.retentionMs).toISOString(),
          new Date(cachedAt).toISOString(),
        );
      } catch {
        // Best effort: the live answer is already being returned.
      }
    },
  };
}

/** Durable last-known-good trending lists (`catalog:trending:<mode>` rows). */
export function createCatalogDurableCache(
  repository: DurableCacheRepository,
  retentionMs: number = CATALOG_STALE_RETENTION_MS,
): CatalogDurableCache {
  const cache = createDurableJsonCache<Omit<CatalogDurableEntry, "cachedAt">>(repository, {
    prefix: "",
    retentionMs,
    parse: (record) => {
      const results = parseCachedSearchResults(record.results);
      if (!results) return null;
      return isJsonString(record.sourceId) ? { results, sourceId: record.sourceId } : { results };
    },
    encode: ({ results, sourceId }) => (sourceId ? { results, sourceId } : { results }),
  });
  return {
    read(key) {
      const saved = cache.read(key);
      return saved ? { cachedAt: saved.cachedAt, ...saved.value } : null;
    },
    write: (key, cachedAt, results, sourceId) => cache.write(key, cachedAt, { results, sourceId }),
  };
}

/**
 * Last-known-good TMDB show and season responses (`tmdb:<path>` rows). Only a
 * JSON object is ever kept or served: a stored scalar or array is not a show.
 */
export function createTmdbDurableCache(
  repository: DurableCacheRepository,
  retentionMs: number = TMDB_STALE_RETENTION_MS,
): TmdbDurableCache {
  return createDurableJsonCache<JsonValue>(repository, {
    prefix: "tmdb:",
    retentionMs,
    parse: (record) => (isJsonObject(record.value) ? record.value : null),
    encode: (value) => (isJsonObject(value) ? { value } : null),
  });
}
