function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function formatTmdbDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Conservative playable rule for pickers/navigation: hide only when a future air date
 * is known. Missing or unparseable dates stay playable so we never block real content.
 */
function normalizeAirDateKey(airDate: string): string | null {
  const trimmed = airDate.trim();
  if (!trimmed) return null;
  const key = trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
  if (!/^\d{4}(-\d{2}-\d{2})?$/.test(key)) return null;
  return key;
}

export function isPlayableEpisode(
  airDate: string,
  todayKey = formatTmdbDateKey(new Date()),
): boolean {
  const key = normalizeAirDateKey(airDate);
  if (!key) return true;
  if (key.length === 4) return key <= todayKey.slice(0, 4);
  return key <= todayKey;
}

/** True when a season/episode air date is strictly after today (safe to hide without episode fetch). */
export function isDefinitelyFutureAirDate(
  airDate: string,
  todayKey = formatTmdbDateKey(new Date()),
): boolean {
  const key = normalizeAirDateKey(airDate);
  if (!key) return false;
  if (key.length === 4) return key > todayKey.slice(0, 4);
  return key > todayKey;
}

/** Seasons with no usable air date need a per-season episode fetch to verify playability. */
export function seasonSummaryNeedsEpisodeVerification(airDate: string): boolean {
  return normalizeAirDateKey(airDate) === null;
}

export function filterPlayableEpisodes<T extends { readonly airDate: string }>(
  episodes: readonly T[],
  todayKey = formatTmdbDateKey(new Date()),
): T[] {
  return episodes.filter((episode) => isPlayableEpisode(episode.airDate, todayKey));
}

export function seasonHasPlayableEpisodes(
  episodes: readonly { readonly airDate: string }[],
  todayKey = formatTmdbDateKey(new Date()),
): boolean {
  return filterPlayableEpisodes(episodes, todayKey).length > 0;
}

export type TmdbSeasonAiring = {
  readonly aired?: { readonly number: number; readonly releaseAt: string };
  readonly next?: { readonly number: number; readonly releaseAt: string };
};

/**
 * Partition a TMDB season's episodes into the latest aired and the next upcoming,
 * by date key. Date-only precision: an episode dated *today* is upcoming.
 */
export function summarizeTmdbSeasonEpisodes(
  episodes: readonly Record<string, unknown>[],
  today: string,
): TmdbSeasonAiring {
  const normalEpisodes = episodes
    .map((episode) => ({
      number: Number(episode.episode_number),
      releaseAt: readString(episode.air_date),
    }))
    .filter(
      (episode) =>
        Number.isFinite(episode.number) && episode.number > 0 && episode.releaseAt.length > 0,
    );

  const aired = normalEpisodes
    .filter((episode) => episode.releaseAt < today)
    .sort((left, right) => right.number - left.number)[0];
  const next = normalEpisodes
    .filter((episode) => episode.releaseAt >= today)
    .sort((left, right) => left.number - right.number)[0];
  return { aired, next };
}
