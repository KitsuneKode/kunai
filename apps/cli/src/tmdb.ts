// =============================================================================
// TMDB episode data — seasons, episode lists, names, air dates
//
// Uses db.videasy.to (same TMDB-format proxy as search, no key needed).
// Falls back to the direct TMDB API with the public project key.
// Results are memory-cached (per-session, never stale during a session).
// =============================================================================

import { cleanEpisodeSynopsis, isPlaceholderEpisodeName } from "@/services/catalog/episode-display";
import { fetchTmdbJsonCached } from "@/services/catalog/tmdb-proxy";
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

// In-memory cache: `${tmdbId}:${season}` → EpisodeInfo[] (raw TMDB rows)
const epCache = new Map<string, EpisodeInfo[]>();
const seasonCache = new Map<string, SeasonSummary[]>();
const showLanguageCache = new Map<string, string>();

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
    showLanguageCache.set(tmdbId, language);
    return language || null;
  } catch {
    showLanguageCache.set(tmdbId, "");
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
  const cachedEpisodes = epCache.get(key);
  if (cachedEpisodes) return cachedEpisodes;

  try {
    const data = await fetchTmdbJsonCached(`/tv/${tmdbId}/season/${season}?language=en-US`);
    const payload = readRecord(data);
    const episodes = Array.isArray(payload.episodes) ? payload.episodes.map(readRecord) : [];
    const eps = await enrichEpisodesWithOriginalLanguage(
      tmdbId,
      season,
      mapTmdbEpisodeRows(episodes),
    );

    epCache.set(key, eps);
    return eps;
  } catch {
    return null;
  }
}

async function resolvePlayableSeasonSummaries(
  tmdbId: string,
  candidates: readonly SeasonSummaryCandidate[],
): Promise<SeasonSummary[]> {
  const definite = candidates.filter((summary) => !isDefinitelyFutureAirDate(summary.airDate));
  const needsVerification = definite.filter((summary) =>
    seasonSummaryNeedsEpisodeVerification(summary.airDate),
  );
  const knownPlayable = definite.filter(
    (summary) => !seasonSummaryNeedsEpisodeVerification(summary.airDate),
  );

  if (needsVerification.length === 0) {
    return knownPlayable.map(stripSeasonCandidate);
  }

  const verified = await Promise.all(
    needsVerification.map(async (summary): Promise<SeasonSummary | null> => {
      const episodes = await fetchEpisodesRaw(tmdbId, summary.number);
      return seasonHasPlayableEpisodes(episodes ?? []) ? stripSeasonCandidate(summary) : null;
    }),
  );

  const playable = [
    ...knownPlayable.map(stripSeasonCandidate),
    ...verified.filter((summary): summary is SeasonSummary => summary !== null),
  ];
  return playable.sort((left, right) => left.number - right.number);
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
  const cachedSeasons = seasonCache.get(key);
  if (cachedSeasons) return cachedSeasons;

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

    const summaries = await resolvePlayableSeasonSummaries(tmdbId, candidates);
    seasonCache.set(key, summaries);
    return summaries;
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

/** All TMDB episode rows for a season, including unreleased placeholders. */
export async function fetchEpisodesUnfiltered(
  tmdbId: string,
  season: number,
): Promise<EpisodeInfo[] | null> {
  return fetchEpisodesRaw(tmdbId, season);
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
  const cached = epCache.get(`${tmdbId}:${season}`);
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

// Format an EpisodeInfo for display in a picker.
// Returns a consistent-width string suitable for interactive list pickers.
export function formatEpisode(ep: EpisodeInfo): string {
  const num = `Ep ${String(ep.number).padStart(3, " ")}`;
  const name = ep.name.slice(0, 44).padEnd(44, " ");
  const yearArr = (ep.airDate || "").split("-");
  const year = (yearArr[0] || "").padEnd(4, " ");
  return `${num}  ${name}  ${year}`;
}
