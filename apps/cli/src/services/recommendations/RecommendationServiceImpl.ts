// =============================================================================
// RecommendationServiceImpl
//
// TMDB-backed recommendation service with JSON file cache.
// Falls back from videasy proxy to direct TMDB API on failure.
// =============================================================================

import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import type { ContentType, SearchResult } from "@/domain/types";
import { writeAtomicJson } from "@/infra/fs/atomic-write";

import type { RecommendationSection, RecommendationService } from "./RecommendationService";

// ── Cache helpers (exported for tests) ────────────────────────────────────────

export function buildRecommendCacheKey(id: string, type: ContentType | "trending"): string {
  return `recommend:${type}:${id}`;
}

export function isCacheExpired(cachedAt: number, ttlMs: number): boolean {
  return Date.now() - cachedAt > ttlMs;
}

// ── TMDB constants ─────────────────────────────────────────────────────────────

const PROXY = "https://db.videasy.net";
const DIRECT = "https://api.themoviedb.org/3";
const KEY = "653bb8af90162bd98fc7ee32bcbbfb3d";
const TTL_SIMILAR = 24 * 60 * 60 * 1000;
const TTL_TRENDING = 6 * 60 * 60 * 1000;

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function tmdbFetch(path: string): Promise<unknown> {
  try {
    const res = await fetch(`${PROXY}${path}`);
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    return await res.json();
  } catch {
    const res = await fetch(`${DIRECT}${path}?api_key=${KEY}`);
    if (!res.ok) throw new Error(`direct ${res.status}`);
    return await res.json();
  }
}

// ── File cache ────────────────────────────────────────────────────────────────

type CacheFile = Record<string, { cachedAt: number; items: readonly SearchResult[] }>;

function cachePath(): string {
  return join(getKunaiPaths().configDir, "recommendations-cache.json");
}

async function readCache(): Promise<CacheFile> {
  try {
    return (await Bun.file(cachePath()).json()) as CacheFile;
  } catch {
    return {};
  }
}

async function writeCache(cache: CacheFile): Promise<void> {
  await writeAtomicJson(cachePath(), cache);
}

// ── TMDB result → SearchResult ────────────────────────────────────────────────

function toSearchResult(item: Record<string, unknown>): SearchResult | null {
  const id = String(item["id"] ?? "");
  const mediaType = String(item["media_type"] ?? "");
  const title = String(item["title"] ?? item["name"] ?? "");
  const year = String(
    (item["release_date"] ?? item["first_air_date"] ?? "").toString().slice(0, 4),
  );
  if (!id || !title) return null;
  const type: ContentType = mediaType === "movie" ? "movie" : "series";
  return {
    id,
    type,
    title,
    year,
    overview: String(item["overview"] ?? ""),
    posterPath: item["poster_path"] ? String(item["poster_path"]) : null,
    rating: typeof item["vote_average"] === "number" ? item["vote_average"] : null,
  };
}

// ── Implementation ────────────────────────────────────────────────────────────

export class RecommendationServiceImpl implements RecommendationService {
  async getForTitle(tmdbId: string, type: ContentType): Promise<RecommendationSection> {
    const key = buildRecommendCacheKey(tmdbId, type);
    const cache = await readCache();
    const entry = cache[key];
    if (entry && !isCacheExpired(entry.cachedAt, TTL_SIMILAR)) {
      return { label: "", reason: "similar", items: entry.items };
    }
    const segment = type === "movie" ? "movie" : "tv";
    const data = (await tmdbFetch(`/${segment}/${tmdbId}/recommendations`)) as {
      results?: Record<string, unknown>[];
    };
    const items = (data.results ?? [])
      .map(toSearchResult)
      .filter((r): r is SearchResult => r !== null)
      .slice(0, 10);
    cache[key] = { cachedAt: Date.now(), items };
    await writeCache(cache);
    return { label: "", reason: "similar", items };
  }

  async getTrending(): Promise<RecommendationSection> {
    const key = buildRecommendCacheKey("trending", "trending");
    const cache = await readCache();
    const entry = cache[key];
    if (entry && !isCacheExpired(entry.cachedAt, TTL_TRENDING)) {
      return { label: "", reason: "trending", items: entry.items };
    }
    const data = (await tmdbFetch("/trending/all/week")) as {
      results?: Record<string, unknown>[];
    };
    const items = (data.results ?? [])
      .map(toSearchResult)
      .filter((r): r is SearchResult => r !== null)
      .slice(0, 10);
    cache[key] = { cachedAt: Date.now(), items };
    await writeCache(cache);
    return { label: "", reason: "trending", items };
  }

  async getGenreAffinity(topGenreIds: number[]): Promise<RecommendationSection> {
    if (topGenreIds.length === 0) return { label: "", reason: "genre-affinity", items: [] };
    const key = buildRecommendCacheKey(topGenreIds.join("-"), "genre-affinity" as ContentType);
    const cache = await readCache();
    const entry = cache[key];
    if (entry && !isCacheExpired(entry.cachedAt, TTL_SIMILAR)) {
      return { label: "", reason: "genre-affinity", items: entry.items };
    }
    const genres = topGenreIds.slice(0, 2).join(",");
    const data = (await tmdbFetch(
      `/discover/tv?with_genres=${genres}&sort_by=vote_average.desc&vote_count.gte=200`,
    )) as { results?: Record<string, unknown>[] };
    const items = (data.results ?? [])
      .map((r) => toSearchResult({ ...r, media_type: "tv" }))
      .filter((r): r is SearchResult => r !== null)
      .slice(0, 10);
    cache[key] = { cachedAt: Date.now(), items };
    await writeCache(cache);
    return { label: "", reason: "genre-affinity", items };
  }
}
