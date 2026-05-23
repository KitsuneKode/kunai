// =============================================================================
// TMDB episode data — seasons, episode lists, names, air dates
//
// Uses db.videasy.net (same TMDB-format proxy as search, no key needed).
// Falls back to the direct TMDB API with the public project key.
// Results are memory-cached (per-session, never stale during a session).
// =============================================================================

const PROXY = "https://db.videasy.net/3";
const DIRECT = "https://api.themoviedb.org/3";
// Public TMDB API key (same as used in the luffy reference project)
const TMDB_KEY = "653bb8af90162bd98fc7ee32bcbbfb3d";

export type EpisodeInfo = {
  number: number;
  name: string;
  airDate: string;
  overview: string;
  stillPath?: string;
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

// In-memory cache: `${tmdbId}:${season}` → EpisodeInfo[]
const epCache = new Map<string, EpisodeInfo[]>();
const seasonCache = new Map<string, SeasonSummary[]>();

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Returns season metadata for a series (excludes specials).
// Returns null if both the proxy and direct TMDB API are unreachable.
export async function fetchSeasonSummaries(tmdbId: string): Promise<SeasonSummary[] | null> {
  const key = tmdbId;
  const cachedSeasons = seasonCache.get(key);
  if (cachedSeasons) return cachedSeasons;

  try {
    // Try proxy first, fall back to direct
    const data = await fetchJson(`${PROXY}/tv/${tmdbId}`).catch(() =>
      fetchJson(`${DIRECT}/tv/${tmdbId}?api_key=${TMDB_KEY}`),
    );

    const payload = readRecord(data);
    const seasons = Array.isArray(payload.seasons) ? payload.seasons.map(readRecord) : [];

    const summaries = seasons
      .filter((s) => Number(s.season_number) > 0 && Number(s.episode_count) > 0)
      .map((s) => ({
        number: Number(s.season_number),
        name: readString(s.name) || `Season ${Number(s.season_number)}`,
        posterPath: readString(s.poster_path) || undefined,
      }))
      .sort((a, b) => a.number - b.number);

    seasonCache.set(key, summaries);
    return summaries;
  } catch {
    // Don't cache failures — a retry after reconnect should try again.
    return null;
  }
}

// Returns the list of season numbers for a series (excludes specials).
// Returns null if both the proxy and direct TMDB API are unreachable.
export async function fetchSeasons(tmdbId: string): Promise<number[] | null> {
  const summaries = await fetchSeasonSummaries(tmdbId);
  return summaries?.map((season) => season.number) ?? null;
}

// Returns episode list for a specific season.
// Returns null if both the proxy and direct TMDB API are unreachable.
export async function fetchEpisodes(tmdbId: string, season: number): Promise<EpisodeInfo[] | null> {
  const key = `${tmdbId}:${season}`;
  const cachedEpisodes = epCache.get(key);
  if (cachedEpisodes) return cachedEpisodes;

  try {
    const data = await fetchJson(`${PROXY}/tv/${tmdbId}/season/${season}`).catch(() =>
      fetchJson(`${DIRECT}/tv/${tmdbId}/season/${season}?api_key=${TMDB_KEY}`),
    );

    const payload = readRecord(data);
    const episodes = Array.isArray(payload.episodes) ? payload.episodes.map(readRecord) : [];
    const eps: EpisodeInfo[] = episodes.map((e) => ({
      number: Number(e.episode_number),
      name: typeof e.name === "string" && e.name ? e.name : `Episode ${Number(e.episode_number)}`,
      airDate: typeof e.air_date === "string" ? e.air_date : "",
      overview: (typeof e.overview === "string" ? e.overview : "").slice(0, 100),
      stillPath: readString(e.still_path) || undefined,
    }));

    epCache.set(key, eps);
    return eps;
  } catch {
    // Don't cache failures — a retry after reconnect should try again.
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Fetches seasons + first season episodes in parallel — reduces perceived latency.
// Returns null fields when TMDB is unreachable.
export async function fetchSeriesData(
  tmdbId: string,
  preferredSeason?: number,
): Promise<{ seasons: number[] | null; episodes: EpisodeInfo[] | null }> {
  // Run both in parallel: get the season list AND pre-load the likely season.
  const [seasons] = await Promise.all([
    fetchSeasons(tmdbId),
    fetchEpisodes(tmdbId, preferredSeason ?? 1), // warm the cache
  ]);
  if (!seasons) return { seasons: null, episodes: null };
  const targetSeason = preferredSeason ?? seasons[0] ?? 1;
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
  return cached.find((row) => row.number === episode);
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
