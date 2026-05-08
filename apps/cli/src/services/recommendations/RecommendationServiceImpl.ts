// =============================================================================
// RecommendationServiceImpl
//
// TMDB-backed recommendation service with SQLite cache.
// Falls back from videasy proxy to direct TMDB API on failure.
// =============================================================================

import type { ContentType, SearchResult } from "@/domain/types";
import { RecommendationCacheRepository } from "@kunai/storage";

import type {
  RecommendationHistorySeed,
  RecommendationSection,
  RecommendationService,
} from "./RecommendationService";

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
    const joiner = path.includes("?") ? "&" : "?";
    const res = await fetch(`${DIRECT}${path}${joiner}api_key=${KEY}`);
    if (!res.ok) throw new Error(`direct ${res.status}`);
    return await res.json();
  }
}

// ── SQLite cache helpers ──────────────────────────────────────────────────────

type CacheValue = { cachedAt: number; items: readonly SearchResult[] };

// ── TMDB result → SearchResult ────────────────────────────────────────────────

function toSearchResult(
  item: Record<string, unknown>,
  fallbackMediaType?: "movie" | "tv",
): SearchResult | null {
  const id = String(item["id"] ?? "");
  const mediaType = String(item["media_type"] ?? fallbackMediaType ?? "");
  const title = String(item["title"] ?? item["name"] ?? "");
  const year = String(
    (item["release_date"] ?? item["first_air_date"] ?? "").toString().slice(0, 4),
  );
  if (!id || !title) return null;
  if (mediaType !== "movie" && mediaType !== "tv") return null;
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
  constructor(private readonly cacheRepository: RecommendationCacheRepository) {}

  async clearCache(): Promise<void> {
    this.cacheRepository.clear();
  }

  private readCacheEntry(key: string, ttlMs: number): CacheValue | null {
    const entry = this.cacheRepository.get(key);
    if (!entry) return null;
    try {
      const parsed = JSON.parse(entry.payloadJson) as CacheValue;
      if (!parsed || typeof parsed.cachedAt !== "number" || !Array.isArray(parsed.items)) {
        return null;
      }
      return isCacheExpired(parsed.cachedAt, ttlMs) ? null : parsed;
    } catch {
      return null;
    }
  }

  private writeCacheEntry(key: string, value: CacheValue, ttlMs: number): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    this.cacheRepository.set(key, JSON.stringify(value), expiresAt, now.toISOString());
  }

  async getForTitle(tmdbId: string, type: ContentType): Promise<RecommendationSection> {
    const key = buildRecommendCacheKey(tmdbId, type);
    const entry = this.readCacheEntry(key, TTL_SIMILAR);
    if (entry) {
      return { label: "", reason: "similar", items: entry.items };
    }
    const segment = type === "movie" ? "movie" : "tv";
    const data = (await tmdbFetch(`/${segment}/${tmdbId}/recommendations`).catch(() => null)) as {
      results?: Record<string, unknown>[];
    } | null;
    const items = (data?.results ?? [])
      .map((r) => toSearchResult(r, segment === "movie" ? "movie" : "tv"))
      .filter((r): r is SearchResult => r !== null)
      .slice(0, 10);
    this.writeCacheEntry(key, { cachedAt: Date.now(), items }, TTL_SIMILAR);
    return { label: "", reason: "similar", items };
  }

  async getTrending(): Promise<RecommendationSection> {
    const key = buildRecommendCacheKey("trending", "trending");
    const entry = this.readCacheEntry(key, TTL_TRENDING);
    if (entry) {
      return { label: "", reason: "trending", items: entry.items };
    }
    const data = (await tmdbFetch("/trending/all/week").catch(() => null)) as {
      results?: Record<string, unknown>[];
    } | null;
    const items = (data?.results ?? [])
      .map((r) => toSearchResult(r))
      .filter((r): r is SearchResult => r !== null)
      .slice(0, 10);
    this.writeCacheEntry(key, { cachedAt: Date.now(), items }, TTL_TRENDING);
    return { label: "", reason: "trending", items };
  }

  async getPersonalizedByHistory(
    historyEntries: readonly RecommendationHistorySeed[],
  ): Promise<RecommendationSection> {
    if (historyEntries.length === 0) {
      return { label: "", reason: "genre-affinity", items: [] };
    }

    const recentUnique = [...dedupeHistory(historyEntries)]
      .sort(
        (a: RecommendationHistorySeed, b: RecommendationHistorySeed) =>
          Date.parse(b.watchedAt) - Date.parse(a.watchedAt),
      )
      .slice(0, 10);
    if (recentUnique.length === 0) {
      return { label: "", reason: "genre-affinity", items: [] };
    }

    const profileKey = buildRecommendCacheKey(
      recentUnique.map((entry) => `${entry.type}:${entry.title}`).join("|"),
      "genre-affinity" as ContentType,
    );
    const cached = this.readCacheEntry(profileKey, TTL_SIMILAR);
    if (cached) {
      return { label: "", reason: "genre-affinity", items: cached.items };
    }

    const watchedTitles = new Set(
      recentUnique.map((entry: RecommendationHistorySeed) => normalizeTitle(entry.title)),
    );
    const genreWeights = new Map<number, number>();
    const now = Date.now();
    const halfLifeMs = 30 * 24 * 60 * 60 * 1000;

    for (const entry of recentUnique as readonly RecommendationHistorySeed[]) {
      const resolved = await resolveTmdbTitle(entry).catch(() => null);
      if (!resolved) continue;
      const genres = await fetchTmdbGenres(resolved.id, resolved.mediaType).catch(() => []);
      const watchedAtMs = Date.parse(entry.watchedAt);
      const ageMs = Number.isNaN(watchedAtMs) ? 0 : Math.max(0, now - watchedAtMs);
      const weight = 2 ** -(ageMs / halfLifeMs);
      for (const genreId of genres) {
        genreWeights.set(genreId, (genreWeights.get(genreId) ?? 0) + weight);
      }
    }

    const topGenres = [...genreWeights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([genreId]) => genreId);
    if (topGenres.length === 0) {
      return { label: "", reason: "genre-affinity", items: [] };
    }

    const [movieCandidates, tvCandidates] = await Promise.all([
      discoverByGenres(topGenres, "movie"),
      discoverByGenres(topGenres, "tv"),
    ]);

    const scored = [...movieCandidates, ...tvCandidates]
      .filter((candidate) => !watchedTitles.has(normalizeTitle(candidate.item.title)))
      .map((candidate) => ({
        item: candidate.item,
        score: candidate.genreIds.reduce(
          (sum, genreId) => sum + (genreWeights.get(genreId) ?? 0),
          0,
        ),
      }))
      .sort((a, b) => b.score - a.score);

    const best = scored
      .filter((entry) => entry.score > 0)
      .slice(0, 10)
      .map((entry) => entry.item);
    const items = best.length > 0 ? best : scored.slice(0, 10).map((entry) => entry.item);
    this.writeCacheEntry(profileKey, { cachedAt: Date.now(), items }, TTL_SIMILAR);
    return { label: "", reason: "genre-affinity", items };
  }

  async getGenreAffinity(topGenreIds: number[]): Promise<RecommendationSection> {
    if (topGenreIds.length === 0) return { label: "", reason: "genre-affinity", items: [] };
    const key = buildRecommendCacheKey(topGenreIds.join("-"), "genre-affinity" as ContentType);
    const entry = this.readCacheEntry(key, TTL_SIMILAR);
    if (entry) {
      return { label: "", reason: "genre-affinity", items: entry.items };
    }
    const genres = topGenreIds.slice(0, 3).join(",");
    const [tvData, movieData] = await Promise.all([
      tmdbFetch(
        `/discover/tv?with_genres=${genres}&sort_by=vote_average.desc&vote_count.gte=200`,
      ).catch(() => null) as Promise<{ results?: Record<string, unknown>[] } | null>,
      tmdbFetch(
        `/discover/movie?with_genres=${genres}&sort_by=vote_average.desc&vote_count.gte=200`,
      ).catch(() => null) as Promise<{ results?: Record<string, unknown>[] } | null>,
    ]);

    const seen = new Set<string>();
    const items = [...(tvData?.results ?? []), ...(movieData?.results ?? [])]
      .map((r) => toSearchResult(r, r["title"] ? "movie" : "tv"))
      .filter((r): r is SearchResult => r !== null)
      .filter((item) => {
        const dedupeKey = `${item.type}:${item.id}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      })
      .slice(0, 10);
    this.writeCacheEntry(key, { cachedAt: Date.now(), items }, TTL_SIMILAR);
    return { label: "", reason: "genre-affinity", items };
  }
}

function dedupeHistory(
  entries: readonly RecommendationHistorySeed[],
): readonly RecommendationHistorySeed[] {
  const seen = new Set<string>();
  const out: RecommendationHistorySeed[] = [];
  for (const entry of entries) {
    const key = `${entry.type}:${normalizeTitle(entry.title)}`;
    if (normalizeTitle(entry.title).length > 0 && !seen.has(key)) {
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

async function resolveTmdbTitle(
  entry: RecommendationHistorySeed,
): Promise<{ id: string; mediaType: "movie" | "tv" } | null> {
  const mediaType = entry.type === "movie" ? "movie" : "tv";
  if (entry.title.length === 0) return null;
  const search = (await tmdbFetch(
    `/search/${mediaType}?query=${encodeURIComponent(entry.title)}&include_adult=false&page=1`,
  )) as { results?: Record<string, unknown>[] };
  const match = (search.results ?? []).find((item) => String(item["id"] ?? "") !== "");
  if (!match) return null;
  return { id: String(match["id"]), mediaType };
}

async function fetchTmdbGenres(id: string, mediaType: "movie" | "tv"): Promise<readonly number[]> {
  const details = (await tmdbFetch(`/${mediaType}/${id}`)) as {
    genres?: Array<{ id?: number }>;
  };
  return (details.genres ?? [])
    .map((genre) => genre.id)
    .filter((genreId): genreId is number => typeof genreId === "number");
}

async function discoverByGenres(
  genreIds: readonly number[],
  mediaType: "movie" | "tv",
): Promise<readonly { item: SearchResult; genreIds: readonly number[] }[]> {
  const genres = genreIds.join(",");
  const data = (await tmdbFetch(
    `/discover/${mediaType}?with_genres=${genres}&sort_by=vote_average.desc&vote_count.gte=200&page=1`,
  ).catch(() => null)) as {
    results?: Record<string, unknown>[];
  } | null;
  const candidates = (data?.results ?? [])
    .map((result) => {
      const item = toSearchResult(result, mediaType);
      if (!item) return null;
      const resultGenreIds = Array.isArray(result["genre_ids"])
        ? result["genre_ids"].filter((value): value is number => typeof value === "number")
        : [];
      return { item, genreIds: resultGenreIds };
    })
    .filter(
      (candidate): candidate is { item: SearchResult; genreIds: number[] } => candidate !== null,
    );
  return candidates;
}
