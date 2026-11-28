// =============================================================================
// TMDB episode data — seasons, episode lists, names, air dates
//
// Uses api.videasy.to/3 (same TMDB-format proxy as search, no key needed).
// Falls back to the direct TMDB API with the public project key.
// Results are memory-cached (per-session, never stale during a session).
// =============================================================================

import type { CacheGenerationToken } from "@/infra/concurrency/cache-generation";
import { cleanEpisodeSynopsis, isPlaceholderEpisodeName } from "@/services/catalog/episode-display";
import {
  captureTmdbSessionGeneration,
  commitTmdbSessionIfFresh,
  fetchTmdbJsonCached,
  isTmdbSessionCurrent,
} from "@/services/catalog/tmdb-proxy";
import {
  filterPlayableEpisodes,
  isDefinitelyFutureAirDate,
  seasonHasPlayableEpisodes,
  seasonSummaryNeedsEpisodeVerification,
} from "@/services/catalog/tmdb-release";

export type EpisodeInfo = {
  number: number;
  name: string;
  airDate: string;
  overview: string;
  stillPath?: string;
  runtimeMinutes?: number;
};

export type SeasonInfo = {
  number: number;
  name: string;
  posterPath?: string;
  episodes: EpisodeInfo[];
};

export type SeasonSummary = {
  number: number;
  name: string;
  posterPath?: string;
};

type SeasonSummaryCandidate = SeasonSummary & {
  readonly airDate: string;
};

export const MAX_TMDB_CACHE_ENTRIES = 100;

interface GenerationEntry<T> {
  readonly token: CacheGenerationToken;
  readonly value: T;
}

// In-memory cache: `${tmdbId}:${season}` → EpisodeInfo[] (raw TMDB rows).
// Entries carry the session generation captured before the fetch, so a refresh
// (clearTmdbSessionCache) drops them and a late answer cannot overwrite a newer one.
const epCache = new Map<string, GenerationEntry<EpisodeInfo[]>>();
const seasonCache = new Map<string, GenerationEntry<SeasonSummary[]>>();
const showLanguageCache = new Map<string, string>();

function readCurrent<T>(map: Map<string, GenerationEntry<T>>, key: string): T | undefined {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (!isTmdbSessionCurrent(entry.token)) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
}

function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max = MAX_TMDB_CACHE_ENTRIES): void {
  if (map.size >= max && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
  map.set(key, value);
}

export function clearTmdbMemoryCachesForTest(): void {
  epCache.clear();
  seasonCache.clear();
  showLanguageCache.clear();
}

function mapTmdbEpisodeRows(rows: readonly Record<string, unknown>[]): EpisodeInfo[] {
  return rows.map((episode) => {
    const number = Number(episode.episode_number);
    const rawName = typeof episode.name === "string" ? episode.name : "";
    const rawOverview = typeof episode.overview === "string" ? episode.overview : "";
    return {
      number,
      name: rawName.trim() ? rawName : `Episode ${number}`,
      airDate: typeof episode.air_date === "string" ? episode.air_date : "",
      overview: rawOverview.slice(0, 320),
      stillPath: readString(episode.still_path) || undefined,
      runtimeMinutes:
        typeof episode.runtime === "number" && episode.runtime > 0 ? episode.runtime : undefined,
    };
  });
}

async function resolveShowOriginalLanguage(tmdbId: string): Promise<string | null> {
  const cached = showLanguageCache.get(tmdbId);
  if (cached !== undefined) return cached || null;
  try {
    const data = await fetchTmdbJsonCached(`/tv/${tmdbId}?language=en-US`);
    const language = readString(readRecord(data).original_language);
    setBounded(showLanguageCache, tmdbId, language);
    return language || null;
  } catch {
    // Transient failure must not poison the session permanently with an empty sentinel
    return null;
  }
}

async function enrichEpisodesWithOriginalLanguage(
  tmdbId: string,
  season: number,
  episodes: readonly EpisodeInfo[],
): Promise<EpisodeInfo[]> {
  const needsName = episodes.filter((episode) =>
    isPlaceholderEpisodeName(episode.number, episode.name),
  ).length;
  const needsOverview = episodes.filter(
    (episode) => !cleanEpisodeSynopsis(episode.overview),
  ).length;
  if (needsName === 0 && needsOverview === 0) return [...episodes];

  const language = await resolveShowOriginalLanguage(tmdbId);
  if (!language || language === "en") return [...episodes];

  try {
    const data = await fetchTmdbJsonCached(`/tv/${tmdbId}/season/${season}?language=${language}`);
    const localizedPayload = readRecord(data);
    const localizedEpisodeRows = Array.isArray(localizedPayload.episodes)
      ? localizedPayload.episodes
      : [];
    const localizedRows = localizedEpisodeRows.map(readRecord);
    const localizedByNumber = new Map(
      mapTmdbEpisodeRows(localizedRows).map((episode) => [episode.number, episode] as const),
    );

    return episodes.map((episode) => {
      const localized = localizedByNumber.get(episode.number);
      if (!localized) return episode;

      const englishSynopsis = cleanEpisodeSynopsis(episode.overview);
      const name =
        isPlaceholderEpisodeName(episode.number, episode.name) && !englishSynopsis
          ? localized.name
          : episode.name;
      const overview = englishSynopsis ? episode.overview : localized.overview || episode.overview;

      return {
        ...episode,
        name,
        overview,
        stillPath: episode.stillPath ?? localized.stillPath,
        runtimeMinutes: episode.runtimeMinutes ?? localized.runtimeMinutes,
      };
    });
  } catch {
    return [...episodes];
  }
}

async function fetchEpisodesRaw(tmdbId: string, season: number): Promise<EpisodeInfo[] | null> {
  const key = `${tmdbId}:${season}`;
  const cachedEpisodes = readCurrent(epCache, key);
  if (cachedEpisodes) return cachedEpisodes;

  const token = captureTmdbSessionGeneration();
  try {
    const data = await fetchTmdbJsonCached(`/tv/${tmdbId}/season/${season}?language=en-US`);
    const payload = readRecord(data);
    // A 200 without an episodes array is a failed fetch, not an empty season.
    if (!Array.isArray(payload.episodes)) return null;
    const episodes = payload.episodes.map(readRecord);
    const eps = await enrichEpisodesWithOriginalLanguage(
      tmdbId,
      season,
      mapTmdbEpisodeRows(episodes),
    );

    commitTmdbSessionIfFresh(token, { complete: true }, () => {
      setBounded(epCache, key, { token, value: eps });
    });
    return eps;
  } catch {
    return null;
  }
}

async function resolvePlayableSeasonSummaries(
  tmdbId: string,
  candidates: readonly SeasonSummaryCandidate[],
): Promise<{ readonly summaries: SeasonSummary[]; readonly complete: boolean }> {
  const definite = candidates.filter((summary) => !isDefinitelyFutureAirDate(summary.airDate));
  const needsVerification = definite.filter((summary) =>
    seasonSummaryNeedsEpisodeVerification(summary.airDate),
  );
  const knownPlayable = definite.filter(
    (summary) => !seasonSummaryNeedsEpisodeVerification(summary.airDate),
  );

  if (needsVerification.length === 0) {
    return { summaries: knownPlayable.map(stripSeasonCandidate), complete: true };
  }

  const verified = await Promise.all(
    needsVerification.map(async (summary) => {
      const episodes = await fetchEpisodesRaw(tmdbId, summary.number);
      // null is a failed season fetch (503), not "this season has no episodes".
      if (episodes === null) return { summary: null, failed: true };
      const playable = seasonHasPlayableEpisodes(episodes) ? stripSeasonCandidate(summary) : null;
      return { summary: playable, failed: false };
    }),
  );

  const playable = [
    ...knownPlayable.map(stripSeasonCandidate),
    ...verified
      .map((entry) => entry.summary)
      .filter((summary): summary is SeasonSummary => summary !== null),
  ];
  return {
    summaries: playable.sort((left, right) => left.number - right.number),
    complete: verified.every((entry) => !entry.failed),
  };
}

function stripSeasonCandidate(summary: SeasonSummaryCandidate): SeasonSummary {
  return {
    number: summary.number,
    name: summary.name,
    posterPath: summary.posterPath,
  };
}

// Returns season metadata for a series (excludes specials and unreleased-only seasons).
// Returns null if both the proxy and direct TMDB API are unreachable.
export async function fetchSeasonSummaries(tmdbId: string): Promise<SeasonSummary[] | null> {
  const key = tmdbId;
  const cachedSeasons = readCurrent(seasonCache, key);
  if (cachedSeasons) return cachedSeasons;

  const token = captureTmdbSessionGeneration();
  try {
    const data = await fetchTmdbJsonCached(`/tv/${tmdbId}`);

    const payload = readRecord(data);
    const seasons = Array.isArray(payload.seasons) ? payload.seasons.map(readRecord) : [];

    const candidates: SeasonSummaryCandidate[] = seasons
      .filter((s) => Number(s.season_number) > 0 && Number(s.episode_count) > 0)
      .map((s) => ({
        number: Number(s.season_number),
        name: readString(s.name) || `Season ${Number(s.season_number)}`,
        posterPath: readString(s.poster_path) || undefined,
        airDate: readString(s.air_date),
      }))
      .sort((a, b) => a.number - b.number);

    const resolved = await resolvePlayableSeasonSummaries(tmdbId, candidates);
    commitTmdbSessionIfFresh(token, { complete: resolved.complete }, () => {
      setBounded(seasonCache, key, { token, value: resolved.summaries });
    });
    return resolved.summaries;
  } catch {
    return null;
  }
}

// Returns the list of season numbers for a series (excludes specials and unreleased-only seasons).
// Returns null if both the proxy and direct TMDB API are unreachable.
export async function fetchSeasons(tmdbId: string): Promise<number[] | null> {
  const summaries = await fetchSeasonSummaries(tmdbId);
  return summaries?.map((season) => season.number) ?? null;
}

// Returns playable episode list for a specific season (unreleased rows hidden).
// Returns null if both the proxy and direct TMDB API are unreachable.
export async function fetchEpisodes(tmdbId: string, season: number): Promise<EpisodeInfo[] | null> {
  const raw = await fetchEpisodesRaw(tmdbId, season);
  if (!raw) return null;
  return filterPlayableEpisodes(raw);
}

// Fetches playable season list + episodes for the target season (one season fetch).
// Returns null fields when TMDB is unreachable.
export async function fetchSeriesData(
  tmdbId: string,
  preferredSeason?: number,
): Promise<{ seasons: number[] | null; episodes: EpisodeInfo[] | null }> {
  const summaries = await fetchSeasonSummaries(tmdbId);
  if (!summaries || summaries.length === 0) return { seasons: null, episodes: null };

  const seasons = summaries.map((season) => season.number);
  const targetSeason =
    preferredSeason !== undefined && seasons.includes(preferredSeason)
      ? preferredSeason
      : (seasons[0] ?? 1);
  const episodes = await fetchEpisodes(tmdbId, targetSeason);
  return { seasons, episodes };
}

/** Read a cached season episode row without network (after fetchEpisodes warmed the cache). */
export function lookupCachedEpisode(
  tmdbId: string,
  season: number,
  episode: number,
): EpisodeInfo | undefined {
  const cached = readCurrent(epCache, `${tmdbId}:${season}`);
  if (!cached) return undefined;
  return filterPlayableEpisodes(cached).find((row) => row.number === episode);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
