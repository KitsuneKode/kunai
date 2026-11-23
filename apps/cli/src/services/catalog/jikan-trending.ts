// Jikan (MyAnimeList) as the anime trending fallback.
//
// AniList is the primary anime catalog. When it is down, the anime rail used
// to go empty. Jikan serves MAL's "top airing" list from an independent host;
// each entry is mapped to its AniList id through ARM, because the anime flow
// identifies titles by AniList id. Entries ARM cannot map are dropped rather
// than shipped with an id the rest of the app would misread.

import { stripHtml } from "@/domain/catalog/strip-html";
import { anilistCatalogStructure } from "@/domain/media/anilist-format";
import type { SearchResult, TitleAlias } from "@/domain/types";
import { fetchArmIdGraph, type ArmIdGraph } from "@/services/catalog/arm-client";

export const JIKAN_TOP_AIRING_URL =
  "https://api.jikan.moe/v4/top/anime?filter=airing&sfw=true&limit=15";
const JIKAN_TIMEOUT_MS = 4_000;
const MAX_RESULTS = 12;

export class JikanTrendingUnavailableError extends Error {
  constructor(reason: string, options?: { readonly cause?: unknown }) {
    super(`Jikan trending is unavailable: ${reason}`, options);
    this.name = "JikanTrendingUnavailableError";
  }
}

type JikanAnime = {
  readonly mal_id?: number;
  readonly title?: string | null;
  readonly title_english?: string | null;
  readonly title_japanese?: string | null;
  readonly title_synonyms?: readonly string[] | null;
  readonly type?: string | null;
  readonly episodes?: number | null;
  readonly duration?: string | null;
  readonly synopsis?: string | null;
  readonly score?: number | null;
  readonly members?: number | null;
  readonly year?: number | null;
  readonly aired?: { readonly prop?: { readonly from?: { readonly year?: number | null } } };
  readonly images?: { readonly jpg?: { readonly large_image_url?: string | null } };
};

export type JikanTrendingDeps = {
  readonly fetchImpl?: typeof fetch;
  readonly lookupArm?: (
    malId: string,
    signal?: AbortSignal,
  ) => Promise<ArmIdGraph | null | undefined>;
};

/** Jikan `type` → the AniList `format` vocabulary `anilistCatalogStructure` reads. */
function anilistFormatFromJikanType(type: string | null | undefined): string | undefined {
  switch (type) {
    case "TV":
      return "TV";
    case "Movie":
      return "MOVIE";
    case "OVA":
      return "OVA";
    case "ONA":
      return "ONA";
    case "Special":
    case "TV Special":
      return "SPECIAL";
    case "Music":
      return "MUSIC";
    default:
      return undefined;
  }
}

/** "24 min per ep" / "1 hr 52 min" → minutes. */
export function parseJikanDurationMinutes(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const hours = /(\d+)\s*hr/.exec(value)?.[1];
  const minutes = /(\d+)\s*min/.exec(value)?.[1];
  const total = (hours ? Number(hours) * 60 : 0) + (minutes ? Number(minutes) : 0);
  return total > 0 ? total : undefined;
}

export function jikanAnimeToSearchResult(
  anime: JikanAnime,
  anilistId: string,
): SearchResult | null {
  if (anime.mal_id === undefined) return null;
  const title = anime.title_english || anime.title || anime.title_japanese || "";
  if (!title) return null;
  const structure = anilistCatalogStructure({
    format: anilistFormatFromJikanType(anime.type),
    episodes: anime.episodes ?? null,
    durationMinutes: parseJikanDurationMinutes(anime.duration) ?? null,
  });
  const aliases: TitleAlias[] = [
    { kind: "provider", value: title },
    anime.title_english ? { kind: "english", value: anime.title_english } : null,
    anime.title ? { kind: "romaji", value: anime.title } : null,
    anime.title_japanese ? { kind: "native", value: anime.title_japanese } : null,
    ...(anime.title_synonyms ?? [])
      .slice(0, 3)
      .map((value): TitleAlias => ({ kind: "synonym", value })),
  ].filter((alias): alias is TitleAlias => Boolean(alias?.value));
  const posterPath = anime.images?.jpg?.large_image_url ?? null;
  const year = anime.year ?? anime.aired?.prop?.from?.year ?? null;
  return {
    id: anilistId,
    type: structure.type,
    title,
    titleAliases: aliases,
    year: year ? String(year) : "",
    overview: stripHtml(anime.synopsis ?? "").slice(0, 240),
    posterPath,
    posterSource: posterPath ? "MyAnimeList" : undefined,
    metadataSource: "MyAnimeList trending (Jikan)",
    rating: anime.score ?? null,
    popularity: anime.members ?? null,
    episodeCount: structure.episodeCount,
    durationSeconds: structure.durationSeconds,
    isAnime: true,
    externalIds: { anilistId, malId: String(anime.mal_id) },
  };
}

/**
 * Top airing anime from Jikan, mapped to AniList ids through ARM. Rejects when
 * Jikan is unreachable or no entry could be mapped, so the caller can fall
 * through to the durable last-known-good list.
 */
export async function loadJikanAnimeTrending(
  signal?: AbortSignal,
  deps: JikanTrendingDeps = {},
): Promise<SearchResult[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookupArm =
    deps.lookupArm ?? ((malId, armSignal) => fetchArmIdGraph("myanimelist", malId, armSignal));
  const timeout = AbortSignal.timeout(JIKAN_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(JIKAN_TOP_AIRING_URL, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    throw new JikanTrendingUnavailableError("request failed", { cause });
  }
  if (!response.ok) throw new JikanTrendingUnavailableError(`HTTP ${response.status}`);
  let payload: { readonly data?: readonly JikanAnime[] } | null;
  try {
    // SAFETY: Jikan's documented /top/anime envelope; every field read below is optional.
    payload = (await response.json()) as { readonly data?: readonly JikanAnime[] } | null;
  } catch (cause) {
    throw new JikanTrendingUnavailableError("unreadable payload", { cause });
  }
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  if (entries.length === 0) throw new JikanTrendingUnavailableError("empty list");

  const mapped = await Promise.all(
    entries.map(async (anime) => {
      if (anime.mal_id === undefined) return null;
      const graph = await lookupArm(String(anime.mal_id), signal);
      return graph?.anilistId ? jikanAnimeToSearchResult(anime, graph.anilistId) : null;
    }),
  );
  const results = mapped
    .filter((entry): entry is SearchResult => entry !== null)
    .slice(0, MAX_RESULTS);
  if (results.length === 0) {
    throw new JikanTrendingUnavailableError("no entry could be mapped to an AniList id");
  }
  return results;
}
