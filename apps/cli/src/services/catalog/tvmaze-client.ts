// TVmaze as the series fallback when every TMDB host is down.
//
// TVmaze has no TMDB ids, so a show is resolved from what the caller already
// knows: the IMDb id when the title carries one (exact), else the name, checked
// against the premiere year. Results are keyed by the caller's TMDB id
// upstream, so nothing downstream ever sees a TVmaze id. Season and episode
// numbering follow broadcast order, which matches TMDB for most scripted TV;
// long-running or anime-style numbering can differ, which is why this is a
// fallback, never a primary.

import { stripHtml } from "@/domain/catalog/strip-html";
import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
  type JsonObject,
  type JsonValue,
} from "@kunai/types";

export const TVMAZE_API_BASE = "https://api.tvmaze.com";
const TVMAZE_TIMEOUT_MS = 4_000;
/** After a transport failure, skip TVmaze for this long instead of paying its timeout. */
const TVMAZE_BREAKER_MS = 5 * 60 * 1000;
/** Episode lists change rarely; TVmaze allows about 20 calls per 10 s per IP. */
const EPISODE_CACHE_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 64;

export type TvmazeShowHint = {
  readonly name: string;
  readonly year?: string;
  readonly imdbId?: string;
};

export type TvmazeEpisode = {
  readonly season: number;
  readonly number: number;
  readonly name: string;
  readonly airdate: string;
  readonly runtimeMinutes?: number;
  readonly summary: string;
  readonly imageUrl?: string;
};

export class TvmazeUnavailableError extends Error {
  constructor(reason: string, options?: { readonly cause?: unknown }) {
    super(`TVmaze is unavailable: ${reason}`, options);
    this.name = "TvmazeUnavailableError";
  }
}

export type TvmazeDeps = {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
};

let brokenUntil = 0;
const showIdCache = new Map<string, number | null>();
const episodeCache = new Map<number, { readonly at: number; readonly episodes: TvmazeEpisode[] }>();

export function resetTvmazeClientForTest(): void {
  brokenUntil = 0;
  showIdCache.clear();
  episodeCache.clear();
}

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key) && map.size >= MAX_CACHE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

/** GET a TVmaze path; null for a 404 (a definitive "no such show"). */
async function getTvmaze(
  path: string,
  signal: AbortSignal | undefined,
  deps: TvmazeDeps,
): Promise<JsonValue | null> {
  const now = deps.now?.() ?? Date.now();
  if (now < brokenUntil) throw new TvmazeUnavailableError("recently unreachable");
  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(`${TVMAZE_API_BASE}${path}`, {
      signal: withTimeoutSignal(signal, TVMAZE_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    brokenUntil = now + TVMAZE_BREAKER_MS;
    throw new TvmazeUnavailableError("request failed", { cause });
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new TvmazeUnavailableError(`HTTP ${response.status}`);
  }
  try {
    const parsed: JsonValue = JSON.parse(await response.text());
    return parsed;
  } catch (cause) {
    throw new TvmazeUnavailableError("unreadable payload", { cause });
  }
}

function premiereYear(show: JsonObject): string | undefined {
  const premiered = show.premiered;
  return isJsonString(premiered) ? premiered.substring(0, 4) : undefined;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The TVmaze show id for a series, or null when it cannot be identified with
 * confidence. A name match must also match the premiere year when the caller
 * knows it (±1 for year-boundary premieres); without a year the normalised
 * name must match exactly. A wrong show is worse than no fallback.
 */
export async function resolveTvmazeShowId(
  hint: TvmazeShowHint,
  signal?: AbortSignal,
  deps: TvmazeDeps = {},
): Promise<number | null> {
  const key = hint.imdbId
    ? `imdb:${hint.imdbId}`
    : `name:${normalizeName(hint.name)}|${hint.year ?? ""}`;
  if (showIdCache.has(key)) return showIdCache.get(key) ?? null;

  if (hint.imdbId && /^tt\d+$/.test(hint.imdbId)) {
    const show = await getTvmaze(
      `/lookup/shows?imdb=${encodeURIComponent(hint.imdbId)}`,
      signal,
      deps,
    );
    const id = isJsonObject(show) && isJsonNumber(show.id) ? show.id : null;
    remember(showIdCache, key, id);
    if (id !== null) return id;
  }

  if (!hint.name.trim()) return null;
  const show = await getTvmaze(
    `/singlesearch/shows?q=${encodeURIComponent(hint.name)}`,
    signal,
    deps,
  );
  let id: number | null = null;
  if (isJsonObject(show) && isJsonNumber(show.id) && isJsonString(show.name)) {
    const year = premiereYear(show);
    const wantedYear = hint.year ? Number.parseInt(hint.year, 10) : Number.NaN;
    const sameName = normalizeName(show.name) === normalizeName(hint.name);
    const yearOk = Number.isFinite(wantedYear)
      ? year !== undefined && Math.abs(Number.parseInt(year, 10) - wantedYear) <= 1
      : sameName;
    if (yearOk) id = show.id;
  }
  remember(showIdCache, key, id);
  return id;
}

function toEpisode(row: JsonValue): TvmazeEpisode | null {
  if (!isJsonObject(row)) return null;
  if (!isJsonNumber(row.season) || !isJsonNumber(row.number)) return null;
  // Specials carry no number in broadcast order; regular episodes only.
  if (isJsonString(row.type) && row.type !== "regular") return null;
  const image =
    isJsonObject(row.image) && isJsonString(row.image.medium) ? row.image.medium : undefined;
  return {
    season: row.season,
    number: row.number,
    name: isJsonString(row.name) ? row.name : `Episode ${row.number}`,
    airdate: isJsonString(row.airdate) ? row.airdate : "",
    runtimeMinutes: isJsonNumber(row.runtime) ? row.runtime : undefined,
    summary: isJsonString(row.summary) ? stripHtml(row.summary) : "",
    imageUrl: image,
  };
}

/** Every regular episode of a show, cached for 30 minutes. */
export async function fetchTvmazeEpisodes(
  showId: number,
  signal?: AbortSignal,
  deps: TvmazeDeps = {},
): Promise<TvmazeEpisode[]> {
  const now = deps.now?.() ?? Date.now();
  const cached = episodeCache.get(showId);
  if (cached && now - cached.at < EPISODE_CACHE_MS) return cached.episodes;
  const payload = await getTvmaze(`/shows/${showId}/episodes`, signal, deps);
  const episodes = Array.isArray(payload)
    ? payload.map(toEpisode).filter((episode): episode is TvmazeEpisode => episode !== null)
    : [];
  remember(episodeCache, showId, { at: now, episodes });
  return episodes;
}

/** Resolve a show and return its episodes, or null when it cannot be identified. */
export async function loadTvmazeEpisodesForHint(
  hint: TvmazeShowHint,
  signal?: AbortSignal,
  deps: TvmazeDeps = {},
): Promise<TvmazeEpisode[] | null> {
  const showId = await resolveTvmazeShowId(hint, signal, deps);
  if (showId === null) return null;
  return fetchTvmazeEpisodes(showId, signal, deps);
}
