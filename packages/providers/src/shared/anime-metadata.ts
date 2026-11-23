import type { ProviderEpisodeOption } from "@kunai/types";

import { TTLCache } from "./provider-cache";
import { createTimeoutSignal } from "./timeout-signal";

export type AnimeEpisodeMetadataSource =
  | "anidb"
  | "anilist"
  | "jikan"
  | "miruro"
  | "allmanga"
  | "merged";

export type AnimeEpisodeMetadata = {
  readonly number: number;
  readonly title?: string;
  readonly synopsis?: string;
  readonly airDate?: string;
  readonly thumbnail?: string;
  readonly isFiller?: boolean;
  readonly isRecap?: boolean;
  readonly source: AnimeEpisodeMetadataSource;
};

const METADATA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const metadataCache = new TTLCache<string, Map<number, AnimeEpisodeMetadata>>(
  METADATA_CACHE_TTL_MS,
);
const seededMetadataCache = new TTLCache<string, Map<number, AnimeEpisodeMetadata>>(
  METADATA_CACHE_TTL_MS,
);

/** Default coverage threshold before skipping AniList/Jikan enrichment on listEpisodes. */
export const EPISODE_METADATA_COVERAGE_THRESHOLD = 0.8;

export function allMangaEpisodeMetadataCacheKey(showId: string, mode: "sub" | "dub"): string {
  return `allanime:${showId}:${mode}`;
}

export function miruroEpisodeMetadataCacheKey(anilistId: string): string {
  return `miruro:${anilistId}`;
}

export function anidbEpisodeMetadataCacheKey(showId: string): string {
  return `anidb:${showId}`;
}

export function seedEpisodeMetadataFromProvider(
  cacheKey: string,
  entries: readonly AnimeEpisodeMetadata[],
): void {
  if (entries.length === 0) return;
  const existing = seededMetadataCache.get(cacheKey) ?? new Map<number, AnimeEpisodeMetadata>();
  const merged = new Map(existing);
  for (const entry of entries) {
    const { number, ...patch } = entry;
    mergeEpisodeMetadata(merged, number, patch);
  }
  seededMetadataCache.set(cacheKey, merged);
}

export function getSeededEpisodeMetadata(
  cacheKey: string,
): ReadonlyMap<number, AnimeEpisodeMetadata> | null {
  const cached = seededMetadataCache.get(cacheKey);
  return cached ? new Map(cached) : null;
}

export function mergeSeededEpisodeMetadataInto(
  target: Map<number, AnimeEpisodeMetadata>,
  cacheKey: string,
): void {
  const seeded = seededMetadataCache.get(cacheKey);
  if (!seeded) return;
  for (const [number, meta] of seeded) {
    const { number: _number, ...patch } = meta;
    mergeEpisodeMetadata(target, number, patch);
  }
}

export function episodeMetadataTitleCoverage(
  metadata: ReadonlyMap<number, AnimeEpisodeMetadata>,
  episodeCount: number,
): number {
  if (episodeCount <= 0 || metadata.size === 0) return 0;
  let titled = 0;
  for (let number = 1; number <= episodeCount; number += 1) {
    if (metadata.get(number)?.title?.trim()) titled += 1;
  }
  return titled / episodeCount;
}

export function shouldSkipExternalEpisodeMetadataEnrichment(
  metadata: ReadonlyMap<number, AnimeEpisodeMetadata>,
  episodeCount: number,
  threshold = EPISODE_METADATA_COVERAGE_THRESHOLD,
): boolean {
  return episodeMetadataTitleCoverage(metadata, episodeCount) >= threshold;
}

export function pipeEpisodeMetadataTitleCoverage(
  entries: readonly { readonly number: number; readonly title?: string }[],
): number {
  if (entries.length === 0) return 0;
  const titled = entries.filter((entry) => entry.title?.trim()).length;
  return titled / entries.length;
}

const JIKAN_BASE = "https://api.jikan.moe/v4";
const ANILIST_GRAPHQL = "https://graphql.anilist.co";

type JikanEpisode = {
  readonly mal_id?: number;
  readonly title?: string;
  readonly aired?: string;
  readonly filler?: boolean;
  readonly recap?: boolean;
};

type AniListStreamingEpisode = {
  readonly title?: string | null;
  readonly thumbnail?: string | null;
};

function metadataCacheKey(
  ids: { readonly anilistId?: string; readonly malId?: string },
  pass: EpisodeMetadataPass,
): string {
  return `${ids.anilistId ?? ""}|${ids.malId ?? ""}|${pass}`;
}

function pickLongerTitle(
  current: string | undefined,
  next: string | undefined,
): string | undefined {
  if (!next?.trim()) return current;
  if (!current?.trim()) return next.trim();
  return next.trim().length > current.trim().length ? next.trim() : current;
}

function mergeEpisodeMetadata(
  into: Map<number, AnimeEpisodeMetadata>,
  number: number,
  patch: Omit<AnimeEpisodeMetadata, "number" | "source"> & {
    readonly source: AnimeEpisodeMetadataSource;
  },
): void {
  if (!Number.isFinite(number) || number < 1) return;
  const existing = into.get(number);
  if (!existing) {
    into.set(number, { number, ...patch, source: patch.source });
    return;
  }
  into.set(number, {
    number,
    title: pickLongerTitle(existing.title, patch.title),
    synopsis: patch.synopsis?.trim() ? patch.synopsis : existing.synopsis,
    airDate: patch.airDate ?? existing.airDate,
    thumbnail: patch.thumbnail ?? existing.thumbnail,
    isFiller: patch.isFiller ?? existing.isFiller,
    isRecap: patch.isRecap ?? existing.isRecap,
    source: "merged",
  });
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, {
      signal: createTimeoutSignal(signal, 20_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Episode metadata plus whether the network pass that produced it finished.
 *
 * Without the flag there is no way to tell "this anime has 12 episodes" from
 * "page 2 of 6 failed", because both arrive as a Map. The caller caches under a
 * 30-day TTL, so conflating them freezes an incomplete catalog for a month.
 */
type EpisodeMetadataFetch = {
  readonly episodes: Map<number, AnimeEpisodeMetadata>;
  readonly complete: boolean;
};

/** Guard against an unbounded catalog; also a reason a pass is incomplete. */
const JIKAN_MAX_PAGES = 50;

async function fetchJikanEpisodes(
  malId: number,
  signal?: AbortSignal,
): Promise<EpisodeMetadataFetch> {
  const episodes = new Map<number, AnimeEpisodeMetadata>();
  let page = 1;

  for (;;) {
    const payload = await fetchJson<{
      readonly data?: readonly JikanEpisode[];
      readonly pagination?: { readonly has_next_page?: boolean };
    }>(`${JIKAN_BASE}/anime/${malId}/episodes?page=${page}`, signal);

    // `fetchJson` returns null for a non-OK response *or* a thrown request, so
    // null here is a transport failure — not an empty page. It used to fall
    // through to `rows = []`, which set `hasNext` false and returned the pages
    // gathered so far as though pagination had completed.
    if (payload === null) return { episodes, complete: false };

    const rows = payload.data ?? [];
    for (const row of rows) {
      const number = row.mal_id;
      if (!number || number < 1) continue;
      mergeEpisodeMetadata(episodes, number, {
        title: row.title?.trim() || undefined,
        airDate: row.aired ? row.aired.slice(0, 10) : undefined,
        isFiller: row.filler === true ? true : undefined,
        isRecap: row.recap === true ? true : undefined,
        source: "jikan",
      });
    }

    if (payload.pagination?.has_next_page !== true || rows.length === 0) {
      return { episodes, complete: true };
    }

    page += 1;
    // Stopping at the ceiling is a truncated catalog, not a finished one.
    if (page > JIKAN_MAX_PAGES) return { episodes, complete: false };
  }
}

async function fetchAniListStreamingEpisodes(
  anilistId: string,
  signal?: AbortSignal,
): Promise<EpisodeMetadataFetch> {
  const episodes = new Map<number, AnimeEpisodeMetadata>();
  try {
    const response = await fetch(ANILIST_GRAPHQL, {
      method: "POST",
      signal: createTimeoutSignal(signal, 20_000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: `query ($id: Int) {
          Media(id: $id, type: ANIME) {
            idMal
            streamingEpisodes { title thumbnail }
          }
        }`,
        variables: { id: Number(anilistId) },
      }),
    });
    if (!response.ok) return { episodes, complete: false };
    const payload = (await response.json()) as {
      readonly data?: {
        readonly Media?: {
          readonly idMal?: number | null;
          readonly streamingEpisodes?: readonly AniListStreamingEpisode[] | null;
        };
      };
    };
    const rows = payload.data?.Media?.streamingEpisodes ?? [];
    rows.forEach((row, index) => {
      const number = index + 1;
      mergeEpisodeMetadata(episodes, number, {
        title: row.title?.trim() || undefined,
        thumbnail: row.thumbnail?.trim() || undefined,
        source: "anilist",
      });
    });
  } catch {
    // Timeout, DNS, abort — none of which mean the anime has no episodes.
    return { episodes, complete: false };
  }
  return { episodes, complete: true };
}

export function mergeMiruroPipeEpisodeMetadata(
  target: Map<number, AnimeEpisodeMetadata>,
  entries: readonly {
    readonly number: number;
    readonly title?: string;
    readonly description?: string;
    readonly airDate?: string;
    readonly image?: string;
    readonly filler?: boolean;
  }[],
): void {
  for (const entry of entries) {
    mergeEpisodeMetadata(target, entry.number, {
      title: entry.title?.trim() || undefined,
      synopsis: entry.description?.trim() || undefined,
      airDate: entry.airDate,
      thumbnail: entry.image?.trim() || undefined,
      isFiller: entry.filler === true ? true : undefined,
      source: "miruro",
    });
  }
}

/**
 * Which external passes a caller still needs.
 *
 * "artwork" is the cheap half: one AniList call for stills. "full" adds the
 * Jikan episode list, which pages 100 at a time under a strict rate limit —
 * worth it for a bare catalog, pure latency for a provider that already knows
 * every episode title. Callers decide with
 * `shouldSkipExternalEpisodeMetadataEnrichment`.
 */
export type EpisodeMetadataPass = "full" | "artwork";

/** Fetch episode titles/synopses/stills keyed by absolute episode number.
 *
 * @deprecated Prefer provider-native episode metadata (Miruro pipe, AllManga
 * episodeInfo cache via `seedEpisodeMetadataFromProvider`). Keep for sparse
 * catalogs, filler/recap flags, and offline backfill when provider coverage
 * is below `EPISODE_METADATA_COVERAGE_THRESHOLD`.
 */
export async function fetchAnimeEpisodeMetadataByNumber(
  ids: { readonly anilistId?: string; readonly malId?: string },
  signal?: AbortSignal,
  pass: EpisodeMetadataPass = "full",
): Promise<Map<number, AnimeEpisodeMetadata>> {
  // A completed full pass already contains everything the artwork pass would
  // fetch, so it answers both; the reverse is not true.
  const cached =
    metadataCache.get(metadataCacheKey(ids, "full")) ??
    (pass === "artwork" ? metadataCache.get(metadataCacheKey(ids, "artwork")) : undefined);
  if (cached) return new Map(cached);

  const merged = new Map<number, AnimeEpisodeMetadata>();
  const malId = ids.malId ? Number.parseInt(ids.malId, 10) : Number.NaN;
  let complete = true;

  if (ids.anilistId) {
    const anilist = await fetchAniListStreamingEpisodes(ids.anilistId, signal);
    for (const [number, meta] of anilist.episodes) {
      mergeEpisodeMetadata(merged, number, meta);
    }
    complete &&= anilist.complete;
  }

  if (pass === "full" && Number.isFinite(malId) && malId > 0) {
    const jikan = await fetchJikanEpisodes(malId, signal);
    for (const [number, meta] of jikan.episodes) {
      mergeEpisodeMetadata(merged, number, meta);
    }
    complete &&= jikan.complete;
  }

  // Return what was gathered — partial metadata is still better than none for
  // *this* call — but only freeze it for 30 days when every source that ran
  // finished. A single transient 429 used to pin an incomplete episode list,
  // with missing titles, air dates and filler flags, for a month.
  //
  // An aborted request is incomplete by the same rule: the caller cancelled, so
  // what arrived is not evidence about the catalog.
  if (complete && !signal?.aborted) {
    metadataCache.set(metadataCacheKey(ids, pass), merged);
  }
  return merged;
}

/**
 * Fill gaps in `target` from an external source. Provider-native values win
 * field by field: the provider knows its own catalog, the external source is
 * only there for what the provider does not carry.
 */
export function mergeExternalEpisodeMetadataInto(
  target: Map<number, AnimeEpisodeMetadata>,
  external: ReadonlyMap<number, AnimeEpisodeMetadata>,
): void {
  for (const [number, meta] of external) {
    const existing = target.get(number);
    if (!existing) {
      target.set(number, meta);
      continue;
    }
    target.set(number, {
      number,
      title: existing.title ?? meta.title,
      synopsis: existing.synopsis ?? meta.synopsis,
      airDate: existing.airDate ?? meta.airDate,
      thumbnail: existing.thumbnail ?? meta.thumbnail,
      isFiller: existing.isFiller ?? meta.isFiller,
      isRecap: existing.isRecap ?? meta.isRecap,
      source: "merged",
    });
  }
}

export function parseAllMangaEpisodeNumber(episode: ProviderEpisodeOption): number {
  const fromDetail = episode.detail?.replace(/^Source episode\s+/i, "").trim();
  const raw = fromDetail || episode.label.replace(/^Episode\s+/i, "").trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : episode.index;
}

export function formatAnimeEpisodeLabel(
  number: number,
  title?: string,
  flags?: { filler?: boolean },
): string {
  const base = title?.trim() ? `Episode ${number} · ${title.trim()}` : `Episode ${number}`;
  return flags?.filler ? `${base} · Filler` : base;
}

export function enrichEpisodeOptionsWithAnimeMetadata(
  episodes: readonly ProviderEpisodeOption[],
  metadata: ReadonlyMap<number, AnimeEpisodeMetadata>,
  resolveEpisodeNumber: (episode: ProviderEpisodeOption) => number = (episode) => episode.index,
): ProviderEpisodeOption[] {
  return episodes.map((episode) => {
    const number = resolveEpisodeNumber(episode);
    const meta = metadata.get(number);
    if (!meta) return episode;

    const title = pickLongerTitle(episode.name, meta.title);
    const synopsis = meta.synopsis?.trim();
    return {
      ...episode,
      name: title,
      label: formatAnimeEpisodeLabel(number, title, { filler: meta.isFiller }),
      detail: synopsis || episode.detail,
      release: meta.airDate ? { ...episode.release, airDate: meta.airDate } : episode.release,
      artwork: meta.thumbnail
        ? { ...episode.artwork, thumbnailUrl: meta.thumbnail }
        : episode.artwork,
    };
  });
}

export function clearAnimeMetadataCacheForTest(): void {
  metadataCache.clear();
  seededMetadataCache.clear();
}
