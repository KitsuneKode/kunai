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
};

export type SeasonInfo = {
  number: number;
  name: string;
  episodes: EpisodeInfo[];
};

// In-memory cache: `${tmdbId}:${season}` → EpisodeInfo[]
const epCache = new Map<string, EpisodeInfo[]>();
const seasonCache = new Map<string, number[]>();

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Returns the list of season numbers for a series (excludes specials).
export async function fetchSeasons(tmdbId: string): Promise<number[]> {
  const key = tmdbId;
  if (seasonCache.has(key)) return seasonCache.get(key)!;

  try {
    // Try proxy first, fall back to direct
    const data = await fetchJson(`${PROXY}/tv/${tmdbId}`).catch(() =>
      fetchJson(`${DIRECT}/tv/${tmdbId}?api_key=${TMDB_KEY}`),
    );

    const seasons = ((data as any).seasons ?? []) as Array<{
      season_number: number;
      episode_count: number;
    }>;

    const nums = seasons
      .filter((s) => s.season_number > 0 && s.episode_count > 0)
      .map((s) => s.season_number)
      .sort((a, b) => a - b);

    seasonCache.set(key, nums);
    return nums;
  } catch {
    return [];
  }
}

// Returns episode list for a specific season.
export async function fetchEpisodes(tmdbId: string, season: number): Promise<EpisodeInfo[]> {
  const key = `${tmdbId}:${season}`;
  if (epCache.has(key)) return epCache.get(key)!;

  try {
    const data = await fetchJson(`${PROXY}/tv/${tmdbId}/season/${season}`).catch(() =>
      fetchJson(`${DIRECT}/tv/${tmdbId}/season/${season}?api_key=${TMDB_KEY}`),
    );

    const eps: EpisodeInfo[] = ((data as any).episodes ?? []).map((e: any) => ({
      number: e.episode_number,
      name: e.name || `Episode ${e.episode_number}`,
      airDate: e.air_date || "",
      overview: (e.overview || "").slice(0, 100),
    }));

    epCache.set(key, eps);
    return eps;
  } catch {
    return [];
  }
}

// Fetches seasons + first season episodes in parallel — reduces perceived latency.
export async function fetchSeriesData(
  tmdbId: string,
  preferredSeason?: number,
): Promise<{ seasons: number[]; episodes: EpisodeInfo[] }> {
  // Run both in parallel: get the season list AND pre-load the likely season.
  const [seasons] = await Promise.all([
    fetchSeasons(tmdbId),
    fetchEpisodes(tmdbId, preferredSeason ?? 1), // warm the cache
  ]);
  const targetSeason = preferredSeason ?? seasons[0] ?? 1;
  const episodes = await fetchEpisodes(tmdbId, targetSeason);
  return { seasons, episodes };
}

// Format an EpisodeInfo for display in a picker.
// Returns a consistent-width string suitable for fzf.
export function formatEpisode(ep: EpisodeInfo): string {
  const num = `Ep ${String(ep.number).padStart(3, " ")}`;
  const name = ep.name.slice(0, 44).padEnd(44, " ");
  const yearArr = (ep.airDate || "").split("-");
  const year = (yearArr[0] || "").padEnd(4, " ");
  return `${num}  ${name}  ${year}`;
}
