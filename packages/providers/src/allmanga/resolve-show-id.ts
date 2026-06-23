import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import { TTLCache } from "../shared/provider-cache";
import { searchAllManga } from "./api-client";

const ALLANIME_API_URL = "https://api.allanime.day/api";
const ALLANIME_REFERER = "https://youtu-chan.com";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";
const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const ANILIST_BRIDGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const anilistBridgeCache = new TTLCache<string, string>(ANILIST_BRIDGE_CACHE_TTL_MS);

export function clearAllMangaAnilistBridgeCacheForTest(): void {
  anilistBridgeCache.clear();
}

export function looksLikeAllMangaOpaqueShowId(showId: string): boolean {
  const normalized = showId.replace(/^allanime:/, "").trim();
  if (!normalized) return false;
  return !/^\d+$/.test(normalized);
}

export function isCatalogIdPassedAsShowId(showId: string, anilistId?: string): boolean {
  const normalized = showId.replace(/^allanime:/, "").trim();
  if (!normalized) return false;
  if (anilistId && normalized === anilistId) return true;
  return /^\d+$/.test(normalized);
}

export async function resolveAllMangaShowId(
  input: Pick<ProviderResolveInput, "title" | "preferredAudioLanguage">,
  context: ProviderRuntimeContext,
): Promise<string> {
  const rawId = input.title.id.replace(/^allanime:/, "").trim();
  const anilistId = input.title.externalIds?.anilistId ?? input.title.anilistId ?? undefined;

  if (rawId && looksLikeAllMangaOpaqueShowId(rawId)) {
    return rawId;
  }

  if (anilistId) {
    const cached = anilistBridgeCache.get(`anilist:${anilistId}`);
    if (cached) return cached;
  }

  if (!anilistId) {
    return rawId;
  }

  const bridged = await bridgeAllMangaShowIdFromAnilist(
    anilistId,
    input.title.title,
    input.preferredAudioLanguage ?? "original",
    context,
  );
  if (bridged) {
    anilistBridgeCache.set(`anilist:${anilistId}`, bridged);
    return bridged;
  }

  return rawId;
}

async function bridgeAllMangaShowIdFromAnilist(
  anilistId: string,
  displayTitle: string,
  preferredAudioLanguage: string,
  context: ProviderRuntimeContext,
): Promise<string | null> {
  const animeLang = resolveAnimeAudioIntent(preferredAudioLanguage).catalogMode;
  const queries = await buildAllMangaBridgeQueries(anilistId, displayTitle, context.signal);

  for (const query of queries) {
    const matches = await searchAllManga(
      context,
      ALLANIME_API_URL,
      ALLANIME_REFERER,
      DEFAULT_UA,
      query,
      animeLang,
      context.signal,
    ).catch(() => []);

    const idMatch = matches.find((result) => String(result.aniListId) === anilistId);
    if (idMatch?.id) return idMatch.id;
  }

  return null;
}

async function buildAllMangaBridgeQueries(
  anilistId: string,
  displayTitle: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const queries: string[] = [...uniqueNonEmpty([displayTitle])];
  try {
    const response = await fetch(ANILIST_GRAPHQL, {
      method: "POST",
      signal: signal ?? AbortSignal.timeout(12_000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: `query ($id: Int) {
          Media(id: $id, type: ANIME) {
            title { romaji english native }
          }
        }`,
        variables: { id: Number(anilistId) },
      }),
    });
    if (!response.ok) return queries.slice(0, 5);
    const payload = (await response.json()) as {
      readonly data?: {
        readonly Media?: {
          readonly title?: {
            readonly romaji?: string | null;
            readonly english?: string | null;
            readonly native?: string | null;
          } | null;
        } | null;
      };
    };
    const title = payload.data?.Media?.title;
    if (title?.romaji) queries.push(title.romaji);
    if (title?.english) queries.push(title.english);
    if (title?.native) queries.push(title.native);
  } catch {
    return queries.slice(0, 5);
  }

  return uniqueNonEmpty(queries).slice(0, 5);
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
