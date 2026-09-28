import { stripHtml } from "@/domain/catalog/strip-html";
import { anilistCatalogStructure } from "@/domain/media/anilist-format";
import type { SearchResult, ShellMode, TitleAlias } from "@/domain/types";
import { fetchTmdbJsonCached } from "@/services/catalog/tmdb-proxy";
import {
  loadYoutubeTrending,
  providerResultToSearchResult,
} from "@/services/youtube/YoutubeRecommendationService";
import {
  getYoutubeProviderConfig,
  invidiousSearch,
  mapInvidiousSearchItem,
} from "@kunai/providers/youtube";
import type { ProviderSearchResult } from "@kunai/types";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const DISCOVERY_CACHE_TTL_MS = 30 * 60 * 1000;
const SURPRISE_CACHE_TTL_MS = 10 * 60 * 1000;

type DiscoveryCacheEntry = {
  readonly expiresAt: number;
  readonly results: readonly SearchResult[];
};

/**
 * Raised when a discovery source could not be read — offline, upstream error,
 * malformed payload, or an aborted request.
 *
 * A loader must reject rather than fold a failure into `[]`: the service caches
 * a resolved list for the whole TTL, so `[]`-on-failure poisons trending for
 * half an hour and the only way out is `clearTrendingCache()`. Rejecting keeps
 * "the upstream is down" distinct from "the provider genuinely has nothing",
 * and only the second is worth caching.
 */
export class DiscoveryUnavailableError extends Error {
  constructor(source: string, reason: string, options?: { readonly cause?: unknown }) {
    super(`${source} discovery is unavailable: ${reason}`, options);
    this.name = "DiscoveryUnavailableError";
  }
}

export type CatalogDiscoveryLoader = (signal?: AbortSignal) => Promise<readonly SearchResult[]>;
export type CatalogSurpriseLoader = (
  options: CatalogSurpriseLoadOptions,
  signal?: AbortSignal,
) => Promise<readonly SearchResult[]>;

export type CatalogSurpriseLoadOptions = {
  readonly random: () => number;
};

export type CatalogDiscoveryLoaders = {
  readonly anime: CatalogDiscoveryLoader;
  readonly tmdb: CatalogDiscoveryLoader;
  readonly youtube?: CatalogDiscoveryLoader;
  readonly animeSurprise?: CatalogSurpriseLoader;
  readonly tmdbSurprise?: CatalogSurpriseLoader;
  readonly youtubeSurprise?: CatalogSurpriseLoader;
};

export class CatalogDiscoveryService {
  private readonly cache = new Map<string, DiscoveryCacheEntry>();
  private readonly inflight = new Map<string, Promise<readonly SearchResult[]>>();

  constructor(
    private readonly loaders: CatalogDiscoveryLoaders = {
      anime: loadAnimeDiscoveryList,
      tmdb: loadTmdbDiscoveryList,
      animeSurprise: loadAnimeSurpriseList,
      tmdbSurprise: loadTmdbSurpriseList,
    },
    private readonly now: () => number = () => Date.now(),
  ) {}

  clearTrendingCache(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  async loadTrending(mode: ShellMode, signal?: AbortSignal): Promise<SearchResult[]> {
    const key = mode;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return [...cached.results];

    const inflight = this.inflight.get(key);
    if (inflight) return [...(await inflight)];

    const loader =
      mode === "anime"
        ? this.loaders.anime
        : mode === "youtube"
          ? (this.loaders.youtube ?? loadYoutubeDiscoveryList)
          : this.loaders.tmdb;
    const results = await this.runLoad(key, DISCOVERY_CACHE_TTL_MS, () => loader(signal));
    return [...results];
  }

  async loadSurprise(
    mode: ShellMode,
    signal?: AbortSignal,
    options: CatalogSurpriseLoadOptions = { random: Math.random },
  ): Promise<SearchResult[]> {
    const bucket = Math.floor(this.now() / SURPRISE_CACHE_TTL_MS);
    const key = `surprise:${mode}:${bucket}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now())
      return shuffleResults(cached.results, options.random);

    const inflight = this.inflight.get(key);
    if (inflight) return shuffleResults(await inflight, options.random);

    const loader =
      mode === "anime"
        ? (this.loaders.animeSurprise ?? loadAnimeSurpriseList)
        : mode === "youtube"
          ? (this.loaders.youtubeSurprise ?? loadYoutubeSurpriseList)
          : (this.loaders.tmdbSurprise ?? loadTmdbSurpriseList);
    const results = await this.runLoad(key, SURPRISE_CACHE_TTL_MS, () => loader(options, signal));
    return shuffleResults(results, options.random);
  }

  /**
   * Runs a loader once per key, caching only a load that actually succeeded.
   *
   * A rejection — an offline blip, an upstream error, or the `AbortError` from
   * navigating away mid-fetch — leaves the cache untouched and propagates, so
   * the next call retries instead of serving an empty tray for the rest of the
   * TTL. An empty resolved list is not cached either: the loaders below reject
   * on failure, but an injected loader that still folds one into `[]` must not
   * be able to poison the cache through this path. In-flight dedup is
   * unchanged — concurrent callers share the one promise, success or failure.
   */
  private async runLoad(
    key: string,
    ttlMs: number,
    load: () => Promise<readonly SearchResult[]>,
  ): Promise<readonly SearchResult[]> {
    const task = load().then((results) => {
      if (results.length > 0) {
        this.cache.set(key, { expiresAt: this.now() + ttlMs, results });
      }
      return results;
    });
    this.inflight.set(key, task);

    return task.finally(() => {
      this.inflight.delete(key);
    });
  }
}

export function createCatalogDiscoveryService(
  loaders?: CatalogDiscoveryLoaders,
): CatalogDiscoveryService {
  return new CatalogDiscoveryService(loaders);
}

async function loadYoutubeDiscoveryList(signal?: AbortSignal): Promise<SearchResult[]> {
  const results = await loadYoutubeTrending(signal);
  return [...results].slice(0, 12);
}

/**
 * Broad-interest queries the surprise spinner draws from. Trending alone made
 * `/surprise` echo `/trending` — a random query through Invidious search gives
 * the tray a genuinely different pool on each cache bucket.
 */
const YOUTUBE_SURPRISE_QUERIES = [
  "documentary",
  "science explained",
  "history deep dive",
  "cooking",
  "nature",
  "space",
  "engineering",
  "travel",
  "music production",
  "interview",
] as const;

async function loadYoutubeSurpriseList(
  options: CatalogSurpriseLoadOptions,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const query = pickRandom(YOUTUBE_SURPRISE_QUERIES, options.random) ?? "documentary";
  const preferredInstanceUrl = getYoutubeProviderConfig().invidiousInstanceUrl;
  try {
    const items = await invidiousSearch(query, { preferredInstanceUrl, signal });
    const videos = items
      .map((item) => mapInvidiousSearchItem(item))
      .filter((item): item is ProviderSearchResult => item !== null)
      .slice(0, 20)
      .map(providerResultToSearchResult);
    if (videos.length > 0) return videos;
  } catch (error) {
    // A caller abort is not a search miss — don't spend a trending fetch
    // on a signal that is already dead.
    if (signal?.aborted) throw error;
    // A search miss is not a tray-killer — trending still spins.
  }
  return loadYoutubeDiscoveryList(signal);
}

async function loadTmdbDiscoveryList(signal?: AbortSignal): Promise<SearchResult[]> {
  const data = (await fetchTmdbJsonCached(
    "/trending/all/week?language=en-US&page=1",
    signal,
    3500,
  ).catch((error: unknown) => {
    throw new DiscoveryUnavailableError("TMDB trending", "request failed", { cause: error });
  })) as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.results)) {
    throw new DiscoveryUnavailableError("TMDB trending", "malformed payload");
  }
  const rawResults = data.results;

  return rawResults
    .map(readRecord)
    .filter((record) => record.media_type === "movie" || record.media_type === "tv")
    .slice(0, 12)
    .map((record): SearchResult => {
      const type = record.media_type === "tv" ? "series" : "movie";
      return {
        id: String(record.id),
        type,
        title: readString(record.title) || readString(record.name) || "Unknown",
        year:
          (readString(record.release_date) || readString(record.first_air_date)).split("-")[0] ||
          "?",
        overview: readString(record.overview).slice(0, 240),
        posterPath: readString(record.poster_path) || null,
        posterSource: readString(record.poster_path) ? "TMDB" : undefined,
        metadataSource: "TMDB trending",
        rating: typeof record.vote_average === "number" ? record.vote_average : null,
        popularity: typeof record.popularity === "number" ? record.popularity : null,
      };
    });
}

async function loadTmdbSurpriseList(
  options: CatalogSurpriseLoadOptions,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const mediaType = options.random() < 0.45 ? "movie" : "tv";
  const sortOptions =
    mediaType === "movie"
      ? ["popularity.desc", "vote_average.desc", "revenue.desc", "primary_release_date.desc"]
      : ["popularity.desc", "vote_average.desc", "first_air_date.desc"];
  const sortBy = pickRandom(sortOptions, options.random) ?? "popularity.desc";
  const page = 1 + Math.floor(options.random() * 20);
  const voteFloor = sortBy === "vote_average.desc" ? 150 : 50;
  const data = (await fetchTmdbJsonCached(
    `/discover/${mediaType}?language=en-US&page=${page}&sort_by=${sortBy}&vote_count.gte=${voteFloor}`,
    signal,
    3500,
  ).catch((error: unknown) => {
    throw new DiscoveryUnavailableError("TMDB surprise", "request failed", { cause: error });
  })) as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.results)) {
    throw new DiscoveryUnavailableError("TMDB surprise", "malformed payload");
  }
  const rawResults = data.results;
  return rawResults
    .map(readRecord)
    .filter((record) => record.id !== null && record.id !== undefined)
    .slice(0, 20)
    .map((record): SearchResult => {
      const type = mediaType === "tv" ? "series" : "movie";
      const posterPath = readString(record.poster_path) || null;
      return {
        id: String(record.id),
        type,
        title: readString(record.title) || readString(record.name) || "Unknown",
        year:
          (readString(record.release_date) || readString(record.first_air_date)).split("-")[0] ||
          "?",
        overview: readString(record.overview).slice(0, 240),
        posterPath,
        posterSource: posterPath ? "TMDB" : undefined,
        metadataSource: `TMDB surprise · ${sortBy.replace(".desc", "")}`,
        rating: typeof record.vote_average === "number" ? record.vote_average : null,
        popularity: typeof record.popularity === "number" ? record.popularity : null,
      };
    });
}

const ANILIST_MEDIA_FIELDS = `
        id
        title{romaji english native}
        coverImage{extraLarge large}
        description(asHtml:false)
        episodes
        format
        duration
        averageScore
        popularity
        startDate{year}
        synonyms`;

async function loadAnimeDiscoveryList(signal?: AbortSignal): Promise<SearchResult[]> {
  const gqlQuery = `query{
    Page(page:1, perPage:12){
      media(type:ANIME, sort:TRENDING_DESC, status_not:NOT_YET_RELEASED){
${ANILIST_MEDIA_FIELDS}
      }
    }
  }`;

  const media = await fetchAniListMedia("AniList trending", { query: gqlQuery }, signal);
  return media.map(anilistMediaToSearchResult);
}

/**
 * Per-title anime recommendations — AniList's `Media.recommendations` edge
 * returns titles the community rated as similar, so post-play "more like
 * this" is anchored to what just finished instead of generic trending. A
 * failure or a title with no recommendations resolves to `[]` so callers can
 * fall back to the trending pool.
 */
export async function loadAnimeRecommendationsForMedia(
  anilistId: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  if (!/^\d+$/.test(anilistId)) return [];
  const gqlQuery = `query($id:Int){
    Media(id:$id, type:ANIME){
      recommendations(sort:RATING_DESC, page:1, perPage:12){
        nodes{ mediaRecommendation{
${ANILIST_MEDIA_FIELDS}
        } }
      }
    }
  }`;

  const payload = await postAniList(
    "AniList recommendations",
    {
      query: gqlQuery,
      variables: { id: Number(anilistId) },
    },
    signal,
  );
  const nodes =
    (
      payload.data as
        | {
            Media?: {
              recommendations?: {
                nodes?: readonly {
                  mediaRecommendation?: AniListDiscoveryMedia | null;
                }[];
              };
            };
          }
        | undefined
    )?.Media?.recommendations?.nodes ?? [];

  return nodes
    .map((node) => node.mediaRecommendation)
    .filter((media): media is AniListDiscoveryMedia => Boolean(media?.id))
    .map((media) => ({
      ...anilistMediaToSearchResult(media),
      metadataSource: "AniList similar titles",
    }));
}

async function loadAnimeSurpriseList(
  options: CatalogSurpriseLoadOptions,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const sortOptions = ["TRENDING_DESC", "POPULARITY_DESC", "SCORE_DESC", "FAVOURITES_DESC"];
  const genreOptions = [
    "Action",
    "Adventure",
    "Comedy",
    "Drama",
    "Fantasy",
    "Mystery",
    "Romance",
    "Sci-Fi",
    "Slice of Life",
    "Supernatural",
    "Thriller",
  ];
  const sort = pickRandom(sortOptions, options.random) ?? "POPULARITY_DESC";
  const genre = pickRandom(genreOptions, options.random);
  const page = 1 + Math.floor(options.random() * 12);
  const gqlQuery = `query($page:Int,$sort:[MediaSort],$genre:String){
    Page(page:$page, perPage:20){
      media(type:ANIME, sort:$sort, genre:$genre, status_not:NOT_YET_RELEASED, isAdult:false){
        id
        title{romaji english native}
        coverImage{extraLarge large}
        description(asHtml:false)
        episodes
        format
        duration
        averageScore
        popularity
        startDate{year}
        synonyms
      }
    }
  }`;

  const media = await fetchAniListMedia(
    "AniList surprise",
    { query: gqlQuery, variables: { page, sort: [sort], genre } },
    signal,
  );

  return media.map((entry) => ({
    ...anilistMediaToSearchResult(entry),
    metadataSource: `AniList surprise · ${genre ?? "mixed"} · ${sort.toLowerCase().replace("_desc", "")}`,
  }));
}

/**
 * Posts a GraphQL document to AniList and returns the parsed payload.
 *
 * Rejects with {@link DiscoveryUnavailableError} on every failure shape —
 * transport error, non-2xx, unparseable body, or a GraphQL error (AniList
 * answers those with HTTP 200 and no `data`). Callers own the shape of `data`.
 */
async function postAniList(
  source: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ readonly data?: unknown }> {
  const response = await fetch(ANILIST_GRAPHQL_URL, {
    method: "POST",
    signal: signal ?? AbortSignal.timeout(3500),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  }).catch((error: unknown) => {
    throw new DiscoveryUnavailableError(source, "request failed", { cause: error });
  });
  if (!response.ok) throw new DiscoveryUnavailableError(source, `HTTP ${response.status}`);

  return (await response.json().catch((error: unknown) => {
    throw new DiscoveryUnavailableError(source, "unreadable payload", { cause: error });
  })) as { readonly data?: unknown };
}

async function fetchAniListMedia(
  source: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<readonly AniListDiscoveryMedia[]> {
  const payload = await postAniList(source, body, signal);
  const media = (
    payload.data as
      | {
          readonly Page?: { readonly media?: readonly AniListDiscoveryMedia[] };
        }
      | undefined
  )?.Page?.media;
  if (!media) throw new DiscoveryUnavailableError(source, "response carried no media page");
  return media;
}

type AniListDiscoveryMedia = {
  readonly id: number;
  readonly title?: {
    readonly romaji?: string | null;
    readonly english?: string | null;
    readonly native?: string | null;
  } | null;
  readonly coverImage?: {
    readonly extraLarge?: string | null;
    readonly large?: string | null;
  } | null;
  readonly description?: string | null;
  readonly episodes?: number | null;
  readonly format?: string | null;
  readonly duration?: number | null;
  readonly averageScore?: number | null;
  readonly popularity?: number | null;
  readonly startDate?: { readonly year?: number | null } | null;
  readonly synonyms?: readonly string[] | null;
};

function anilistMediaToSearchResult(media: AniListDiscoveryMedia): SearchResult {
  const title = media.title?.english || media.title?.romaji || media.title?.native || "Unknown";
  const aliases = buildAniListAliases(title, media);
  const posterPath = media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;
  const structure = anilistCatalogStructure({
    format: media.format,
    episodes: media.episodes,
    durationMinutes: media.duration,
  });

  return {
    id: String(media.id),
    type: structure.type,
    title,
    titleAliases: aliases,
    year: media.startDate?.year ? String(media.startDate.year) : "",
    overview: stripHtml(media.description ?? "").slice(0, 240),
    posterPath,
    posterSource: posterPath ? "AniList" : undefined,
    metadataSource: "AniList trending",
    rating: typeof media.averageScore === "number" ? media.averageScore / 10 : null,
    popularity: media.popularity ?? null,
    episodeCount: structure.episodeCount,
    durationSeconds: structure.durationSeconds,
    isAnime: true,
    externalIds: { anilistId: String(media.id) },
  };
}

function buildAniListAliases(providerTitle: string, media: AniListDiscoveryMedia): TitleAlias[] {
  return [
    { kind: "provider", value: providerTitle },
    media.title?.english ? { kind: "english", value: media.title.english } : null,
    media.title?.romaji ? { kind: "romaji", value: media.title.romaji } : null,
    media.title?.native ? { kind: "native", value: media.title.native } : null,
    ...(media.synonyms ?? []).slice(0, 3).map((value): TitleAlias => ({ kind: "synonym", value })),
  ].filter((value): value is TitleAlias => Boolean(value?.value));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pickRandom<T>(values: readonly T[], random: () => number): T | undefined {
  if (values.length === 0) return undefined;
  return values[Math.floor(random() * values.length)];
}

function shuffleResults(results: readonly SearchResult[], random: () => number): SearchResult[] {
  const shuffled = [...results];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[target];
    if (!current || !replacement) continue;
    shuffled[index] = replacement;
    shuffled[target] = current;
  }
  return shuffled;
}
