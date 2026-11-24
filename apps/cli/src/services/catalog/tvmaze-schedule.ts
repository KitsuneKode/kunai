// TVmaze's daily schedule as the series-calendar stand-in when TMDB is down.
//
// TVmaze has no TMDB ids, so every show is mapped through Wikidata by its
// IMDb or TheTVDB id — exact external ids, never a name match. A show that
// does not map, or whose two ids map to different TMDB shows, is dropped.
//
// Entries carry no season or episode number. TVmaze numbers some shows
// differently from TMDB (The Office US S04E05), and the calendar turns an
// episode number on a released entry into a "+N new" badge, so a TVmaze
// number could claim episodes the user's TMDB-numbered history never had.

import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import type {
  CatalogScheduleItem,
  CatalogScheduleWindow,
} from "@/services/catalog/CatalogScheduleService";
import {
  mapShowsToTmdbTvIds,
  tmdbTvIdForShow,
  type ExternalShowIds,
  type WikidataFetch,
} from "@/services/catalog/wikidata-search";
import { isJsonNumber, isJsonObject, isJsonString, type JsonValue } from "@kunai/types";

const TVMAZE_API = "https://api.tvmaze.com";
const TVMAZE_USER_AGENT = "Kunai (+https://github.com/KitsuneKode/kunai)";
const TVMAZE_TIMEOUT_MS = 4_000;
/** Matches the TMDB airing-today list size. */
const MAX_ENTRIES = 25;
/** TMDB's airing-today list has no region; TVmaze needs one. */
const SCHEDULE_COUNTRY = "US";

export class TvmazeScheduleUnavailableError extends Error {
  constructor(reason: string, options?: { readonly cause?: unknown }) {
    super(`TVmaze schedule is unavailable: ${reason}`, options);
    this.name = "TvmazeScheduleUnavailableError";
  }
}

export interface TvmazeScheduleOptions {
  readonly signal?: AbortSignal;
  readonly fetchImpl?: WikidataFetch;
  /** Test seam for the Wikidata id mapping. */
  readonly mapShows?: typeof mapShowsToTmdbTvIds;
}

/** One show airing in the window, as TVmaze reports it. */
export interface TvmazeScheduledShow extends ExternalShowIds {
  readonly name: string;
  readonly airstamp: string;
  readonly poster: string | null;
  /** TVmaze's 0–100 popularity weight. */
  readonly weight: number;
}

function readShow(entry: JsonValue): TvmazeScheduledShow | null {
  if (!isJsonObject(entry) || !isJsonString(entry.airstamp)) return null;
  // Broadcast entries carry `show`; streaming (web) entries embed it.
  const embedded = isJsonObject(entry._embedded) ? entry._embedded.show : undefined;
  const show = isJsonObject(entry.show) ? entry.show : embedded;
  if (!isJsonObject(show) || !isJsonString(show.name) || show.name.trim() === "") return null;
  const externals = isJsonObject(show.externals) ? show.externals : {};
  const image = isJsonObject(show.image) ? show.image : {};
  const imdb = isJsonString(externals.imdb) ? externals.imdb : undefined;
  const tvdb = isJsonNumber(externals.thetvdb) ? String(externals.thetvdb) : undefined;
  if (!imdb && !tvdb) return null;
  return {
    name: show.name.trim(),
    airstamp: entry.airstamp,
    poster: isJsonString(image.medium) ? image.medium : null,
    weight: isJsonNumber(show.weight) ? show.weight : 0,
    imdb,
    tvdb,
  };
}

/** Shows from a TVmaze schedule payload, one per show (its earliest airing). */
export function readTvmazeSchedule(payload: JsonValue): TvmazeScheduledShow[] {
  if (!Array.isArray(payload)) return [];
  const earliest = new Map<string, TvmazeScheduledShow>();
  for (const entry of payload) {
    const show = readShow(entry);
    if (!show) continue;
    const key = show.imdb ?? `tvdb:${show.tvdb}`;
    const known = earliest.get(key);
    if (!known || show.airstamp < known.airstamp) earliest.set(key, show);
  }
  return [...earliest.values()];
}

async function fetchSchedule(
  path: string,
  options: TvmazeScheduleOptions,
): Promise<TvmazeScheduledShow[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${TVMAZE_API}${path}`, {
      headers: { "user-agent": TVMAZE_USER_AGENT, accept: "application/json" },
      signal: withTimeoutSignal(options.signal, TVMAZE_TIMEOUT_MS),
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new TvmazeScheduleUnavailableError("request failed", { cause });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new TvmazeScheduleUnavailableError(`HTTP ${response.status}`);
  }
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await response.text());
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new TvmazeScheduleUnavailableError("unreadable", { cause });
  }
  return readTvmazeSchedule(parsed);
}

/**
 * Series airing on the window's first local day, identified by TMDB id.
 * Broadcast and streaming schedules are read together; one of them failing
 * is tolerated, both failing (or the id mapping failing) rejects.
 */
export async function loadTvmazeAiringToday(
  window: CatalogScheduleWindow,
  options: TvmazeScheduleOptions = {},
): Promise<CatalogScheduleItem[]> {
  const date = window.dateKey.slice(0, 10);
  const query = `date=${encodeURIComponent(date)}&country=${SCHEDULE_COUNTRY}`;
  const settled = await Promise.allSettled([
    fetchSchedule(`/schedule?${query}`, options),
    fetchSchedule(`/schedule/web?${query}`, options),
  ]);
  options.signal?.throwIfAborted();
  const answered = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (answered.length === 0) {
    const [first] = settled;
    throw first?.status === "rejected"
      ? first.reason
      : new TvmazeScheduleUnavailableError("no schedule");
  }

  const shows = answered
    .flat()
    .sort((left, right) => right.weight - left.weight)
    .slice(0, MAX_ENTRIES * 2);
  if (shows.length === 0) return [];
  const mapping = await (options.mapShows ?? mapShowsToTmdbTvIds)(shows, {
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });

  const seen = new Set<string>();
  const items: CatalogScheduleItem[] = [];
  for (const show of shows) {
    const tmdbId = tmdbTvIdForShow(mapping, show);
    if (!tmdbId || seen.has(tmdbId)) continue;
    seen.add(tmdbId);
    items.push({
      source: "tmdb",
      titleId: tmdbId,
      titleName: show.name,
      type: "series",
      posterPath: show.poster,
      popularity: show.weight,
      releaseAt: show.airstamp,
      releasePrecision: "timestamp",
      status: "unknown",
      via: "TVmaze",
    });
    if (items.length === MAX_ENTRIES) break;
  }
  return items;
}
