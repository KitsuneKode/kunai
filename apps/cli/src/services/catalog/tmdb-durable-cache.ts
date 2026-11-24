import type { TmdbDurableCache } from "@/services/catalog/tmdb-proxy";
import type { RecommendationCacheRepository } from "@kunai/storage";
import { isJsonNumber, isJsonObject, type JsonValue } from "@kunai/types";

/** How long a saved show or season response is kept for outages. */
export const TMDB_STALE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Last-known-good TMDB show and season responses in the cache database
 * (`tmdb:<path>` rows in the shared recommendation cache table). Never throws:
 * an unreadable or unwritable cache degrades to "no saved answer".
 */
export function createTmdbDurableCache(
  repository: Pick<RecommendationCacheRepository, "get" | "set">,
  retentionMs: number = TMDB_STALE_RETENTION_MS,
): TmdbDurableCache {
  return {
    read(path) {
      try {
        const entry = repository.get(`tmdb:${path}`);
        if (!entry) return null;
        const parsed: JsonValue = JSON.parse(entry.payloadJson);
        if (
          !isJsonObject(parsed) ||
          !isJsonNumber(parsed.cachedAt) ||
          !isJsonObject(parsed.value)
        ) {
          return null;
        }
        return { cachedAt: parsed.cachedAt, value: parsed.value };
      } catch {
        return null;
      }
    },
    write(path, cachedAt, value) {
      if (!isJsonObject(value)) return;
      try {
        repository.set(
          `tmdb:${path}`,
          JSON.stringify({ cachedAt, value }),
          new Date(cachedAt + retentionMs).toISOString(),
          new Date(cachedAt).toISOString(),
        );
      } catch {
        // Best effort: the live answer is already being returned.
      }
    },
  };
}
