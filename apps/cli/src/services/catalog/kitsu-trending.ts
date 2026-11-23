// Kitsu as an anime trending fallback.
//
// Kitsu's JSON:API carries cross-site id mappings, so one request yields
// AniList ids directly — no per-entry ARM lookups, unlike the Jikan path.
// Kitsu's own `/trending/anime` is mostly all-time classics and ignores
// `include`, so "this season, most followed" is the trending proxy, topped up
// with "currently airing, most followed" early in a season when the seasonal
// list is still thin. Entries without an AniList mapping are dropped: the anime
// flow identifies titles by AniList id.

import { stripHtml } from "@/domain/catalog/strip-html";
import { anilistCatalogStructure } from "@/domain/media/anilist-format";
import type { SearchResult, TitleAlias } from "@/domain/types";

const KITSU_ANIME_BASE = "https://kitsu.app/api/edge/anime";
const KITSU_FIELDS =
  "&include=mappings&fields%5Bmappings%5D=externalSite,externalId" +
  "&fields%5Banime%5D=canonicalTitle,titles,abbreviatedTitles,subtype,episodeCount,episodeLength,startDate,synopsis,averageRating,userCount,posterImage,mappings";
export const KITSU_CURRENT_POPULAR_URL = `${KITSU_ANIME_BASE}?filter%5Bstatus%5D=current&sort=-userCount&page%5Blimit%5D=15${KITSU_FIELDS}`;
const KITSU_TIMEOUT_MS = 4_000;
const MAX_RESULTS = 12;
/** Below this many mapped seasonal entries, top up from "currently airing". */
const MIN_SEASONAL_RESULTS = 6;

/** Anime broadcast season for a date (Kitsu and AniList share the convention). */
export interface AnimeSeason {
  readonly season: "winter" | "spring" | "summer" | "fall";
  readonly year: number;
}

export function animeSeasonOf(date: Date): AnimeSeason {
  const month = date.getUTCMonth();
  const season = month < 3 ? "winter" : month < 6 ? "spring" : month < 9 ? "summer" : "fall";
  return { season, year: date.getUTCFullYear() };
}

export function kitsuSeasonalPopularUrl(date: Date): string {
  const { season, year } = animeSeasonOf(date);
  return `${KITSU_ANIME_BASE}?filter%5Bseason%5D=${season}&filter%5BseasonYear%5D=${year}&sort=-userCount&page%5Blimit%5D=15${KITSU_FIELDS}`;
}

export class KitsuTrendingUnavailableError extends Error {
  constructor(reason: string, options?: { readonly cause?: unknown }) {
    super(`Kitsu trending is unavailable: ${reason}`, options);
    this.name = "KitsuTrendingUnavailableError";
  }
}

type KitsuAnime = {
  readonly id?: string;
  readonly attributes?: {
    readonly canonicalTitle?: string | null;
    readonly titles?: {
      readonly en?: string | null;
      readonly en_jp?: string | null;
      readonly ja_jp?: string | null;
    } | null;
    readonly abbreviatedTitles?: readonly string[] | null;
    readonly subtype?: string | null;
    readonly episodeCount?: number | null;
    readonly episodeLength?: number | null;
    readonly startDate?: string | null;
    readonly synopsis?: string | null;
    readonly averageRating?: string | null;
    readonly userCount?: number | null;
    readonly posterImage?: {
      readonly large?: string | null;
      readonly original?: string | null;
    } | null;
  };
  readonly relationships?: {
    readonly mappings?: { readonly data?: readonly { readonly id?: string }[] | null };
  };
};

type KitsuMapping = {
  readonly id?: string;
  readonly type?: string;
  readonly attributes?: { readonly externalSite?: string; readonly externalId?: string };
};

type KitsuEnvelope = {
  readonly data?: readonly KitsuAnime[];
  readonly included?: readonly KitsuMapping[];
};

/** Kitsu `subtype` → AniList `format`. */
function anilistFormatFromKitsuSubtype(subtype: string | null | undefined): string | undefined {
  switch (subtype) {
    case "TV":
      return "TV";
    case "movie":
      return "MOVIE";
    case "OVA":
      return "OVA";
    case "ONA":
      return "ONA";
    case "special":
      return "SPECIAL";
    case "music":
      return "MUSIC";
    default:
      return undefined;
  }
}

export function kitsuAnimeToSearchResult(
  anime: KitsuAnime,
  ids: { readonly anilistId: string; readonly malId?: string },
): SearchResult | null {
  const attributes = anime.attributes;
  if (!attributes) return null;
  const title =
    attributes.titles?.en || attributes.canonicalTitle || attributes.titles?.en_jp || "";
  if (!title) return null;
  const structure = anilistCatalogStructure({
    format: anilistFormatFromKitsuSubtype(attributes.subtype),
    episodes: attributes.episodeCount ?? null,
    durationMinutes: attributes.episodeLength ?? null,
  });
  const aliases: TitleAlias[] = [
    { kind: "provider", value: title },
    attributes.titles?.en ? { kind: "english", value: attributes.titles.en } : null,
    attributes.titles?.en_jp ? { kind: "romaji", value: attributes.titles.en_jp } : null,
    attributes.titles?.ja_jp ? { kind: "native", value: attributes.titles.ja_jp } : null,
    ...(attributes.abbreviatedTitles ?? [])
      .slice(0, 3)
      .map((value): TitleAlias => ({ kind: "synonym", value })),
  ].filter((alias): alias is TitleAlias => Boolean(alias?.value));
  const posterPath = attributes.posterImage?.large ?? attributes.posterImage?.original ?? null;
  const rating = Number.parseFloat(attributes.averageRating ?? "");
  return {
    id: ids.anilistId,
    type: structure.type,
    title,
    titleAliases: aliases,
    year: attributes.startDate?.slice(0, 4) ?? "",
    overview: stripHtml(attributes.synopsis ?? "").slice(0, 240),
    posterPath,
    posterSource: posterPath ? "Kitsu" : undefined,
    metadataSource: "Kitsu airing now",
    // Kitsu rates 0–100; the rails use AniList's 0–10 scale.
    rating: Number.isFinite(rating) ? Math.round(rating) / 10 : null,
    popularity: attributes.userCount ?? null,
    episodeCount: structure.episodeCount,
    durationSeconds: structure.durationSeconds,
    isAnime: true,
    externalIds: ids.malId
      ? { anilistId: ids.anilistId, malId: ids.malId }
      : { anilistId: ids.anilistId },
  };
}

/** The cross-site ids Kunai uses for an anime. */
export interface KitsuExternalIds {
  readonly anilistId?: string;
  readonly malId?: string;
}

/** AniList and MAL ids for one anime, from the envelope's included mappings. */
export function kitsuExternalIds(
  anime: KitsuAnime,
  mappingsById: ReadonlyMap<string, KitsuMapping>,
): KitsuExternalIds {
  let anilistId: string | undefined;
  let malId: string | undefined;
  for (const ref of anime.relationships?.mappings?.data ?? []) {
    const mapping = ref.id ? mappingsById.get(ref.id) : undefined;
    const site = mapping?.attributes?.externalSite;
    const value = mapping?.attributes?.externalId;
    if (!value || !/^\d+$/.test(value)) continue;
    if (site === "anilist/anime") anilistId = value;
    if (site === "myanimelist/anime") malId = value;
  }
  return { anilistId, malId };
}

async function fetchKitsuMapped(
  url: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<SearchResult[]> {
  const timeout = AbortSignal.timeout(KITSU_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { accept: "application/vnd.api+json" },
    });
  } catch (cause) {
    throw new KitsuTrendingUnavailableError("request failed", { cause });
  }
  if (!response.ok) throw new KitsuTrendingUnavailableError(`HTTP ${response.status}`);
  let payload: KitsuEnvelope | null;
  try {
    // SAFETY: Kitsu's JSON:API envelope; every field read below is optional.
    payload = (await response.json()) as KitsuEnvelope | null;
  } catch (cause) {
    throw new KitsuTrendingUnavailableError("unreadable payload", { cause });
  }
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const mappingsById = new Map<string, KitsuMapping>();
  for (const included of payload?.included ?? []) {
    if (included.type === "mappings" && included.id) mappingsById.set(included.id, included);
  }
  return entries
    .map((anime) => {
      const ids = kitsuExternalIds(anime, mappingsById);
      return ids.anilistId
        ? kitsuAnimeToSearchResult(anime, { anilistId: ids.anilistId, malId: ids.malId })
        : null;
    })
    .filter((entry): entry is SearchResult => entry !== null);
}

/**
 * This season's most-followed anime, topped up with currently-airing titles
 * when the season is young. Rejects when neither list yields a mapped entry.
 */
export async function loadKitsuAnimeTrending(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<SearchResult[]> {
  let seasonal: SearchResult[] = [];
  let seasonalError: Error | null = null;
  try {
    seasonal = await fetchKitsuMapped(kitsuSeasonalPopularUrl(now), signal, fetchImpl);
  } catch (error) {
    if (signal?.aborted) throw error;
    seasonalError = error instanceof Error ? error : new Error(String(error));
  }
  if (seasonal.length >= MIN_SEASONAL_RESULTS) return seasonal.slice(0, MAX_RESULTS);

  let current: SearchResult[] = [];
  try {
    current = await fetchKitsuMapped(KITSU_CURRENT_POPULAR_URL, signal, fetchImpl);
  } catch (error) {
    if (signal?.aborted || seasonal.length === 0) throw seasonalError ?? error;
  }
  const seen = new Set<string>();
  const merged = [...seasonal, ...current].filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  if (merged.length === 0) {
    throw new KitsuTrendingUnavailableError("no entry carried an AniList mapping");
  }
  return merged.slice(0, MAX_RESULTS);
}
