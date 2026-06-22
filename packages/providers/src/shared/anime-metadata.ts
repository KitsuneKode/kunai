import type { ProviderEpisodeOption } from "@kunai/types";

import { TTLCache } from "./provider-cache";

export type AnimeEpisodeMetadataSource = "anilist" | "jikan" | "miruro" | "allmanga" | "merged";

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

function metadataCacheKey(ids: { readonly anilistId?: string; readonly malId?: string }): string {
  return `${ids.anilistId ?? ""}|${ids.malId ?? ""}`;
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
      signal: signal ?? AbortSignal.timeout(20_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJikanEpisodes(
  malId: number,
  signal?: AbortSignal,
): Promise<Map<number, AnimeEpisodeMetadata>> {
  const episodes = new Map<number, AnimeEpisodeMetadata>();
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const payload = await fetchJson<{
      readonly data?: readonly JikanEpisode[];
      readonly pagination?: { readonly has_next_page?: boolean };
    }>(`${JIKAN_BASE}/anime/${malId}/episodes?page=${page}`, signal);
    const rows = payload?.data ?? [];
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
    hasNext = payload?.pagination?.has_next_page === true && rows.length > 0;
    page += 1;
    if (page > 50) break;
  }

  return episodes;
}

async function fetchAniListStreamingEpisodes(
  anilistId: string,
  signal?: AbortSignal,
): Promise<Map<number, AnimeEpisodeMetadata>> {
  const episodes = new Map<number, AnimeEpisodeMetadata>();
  try {
    const response = await fetch(ANILIST_GRAPHQL, {
      method: "POST",
      signal: signal ?? AbortSignal.timeout(20_000),
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
    if (!response.ok) return episodes;
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
    return episodes;
  }
  return episodes;
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
): Promise<Map<number, AnimeEpisodeMetadata>> {
  const cacheKey = metadataCacheKey(ids);
  const cached = metadataCache.get(cacheKey);
  if (cached) return new Map(cached);

  const merged = new Map<number, AnimeEpisodeMetadata>();
  const malId = ids.malId ? Number.parseInt(ids.malId, 10) : Number.NaN;

  if (ids.anilistId) {
    const anilistEpisodes = await fetchAniListStreamingEpisodes(ids.anilistId, signal);
    for (const [number, meta] of anilistEpisodes) {
      mergeEpisodeMetadata(merged, number, meta);
    }
  }

  if (Number.isFinite(malId) && malId > 0) {
    const jikanEpisodes = await fetchJikanEpisodes(malId, signal);
    for (const [number, meta] of jikanEpisodes) {
      mergeEpisodeMetadata(merged, number, meta);
    }
  }

  metadataCache.set(cacheKey, merged);
  return merged;
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
