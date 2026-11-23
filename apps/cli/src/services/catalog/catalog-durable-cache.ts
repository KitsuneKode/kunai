import type { SearchResult } from "@/domain/types";
import type { CatalogDurableCache } from "@/services/catalog/CatalogDiscoveryService";
import type { RecommendationCacheRepository } from "@kunai/storage";
import { isJsonNumber, isJsonObject, type JsonValue } from "@kunai/types";

/** How long a last-known-good trending list is kept for outages and cold starts. */
export const CATALOG_STALE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Durable last-known-good trending lists in the cache database, reusing the
 * recommendation cache table. Row expiry is the retention window, not the
 * freshness TTL: freshness is the caller's memory cache, and a row that
 * expired at the freshness TTL could never serve an outage (the repository
 * deletes expired rows on read).
 *
 * Never throws: a cache that cannot be read or written degrades to "no last
 * good answer", it does not break the rail.
 */
export function createCatalogDurableCache(
  repository: Pick<RecommendationCacheRepository, "get" | "set">,
  retentionMs: number = CATALOG_STALE_RETENTION_MS,
): CatalogDurableCache {
  return {
    read(key) {
      try {
        const entry = repository.get(key);
        if (!entry) return null;
        const parsed: JsonValue = JSON.parse(entry.payloadJson);
        if (
          !isJsonObject(parsed) ||
          !isJsonNumber(parsed.cachedAt) ||
          !Array.isArray(parsed.results)
        ) {
          return null;
        }
        // SAFETY: written by `write` below from SearchResult[]; shape checked above.
        return { cachedAt: parsed.cachedAt, results: parsed.results as SearchResult[] };
      } catch {
        return null;
      }
    },
    write(key, cachedAt, results) {
      try {
        repository.set(
          key,
          JSON.stringify({ cachedAt, results }),
          new Date(cachedAt + retentionMs).toISOString(),
          new Date(cachedAt).toISOString(),
        );
      } catch {
        // Best effort: the live answer is already being returned.
      }
    },
  };
}
