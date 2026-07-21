import type { SearchResult, ShellMode, TitleAlias } from "@/domain/types";
import { fetchTmdbJsonCached } from "@/services/catalog/tmdb-proxy";
import { loadYoutubeTrending } from "@/services/youtube/YoutubeRecommendationService";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const DISCOVERY_CACHE_TTL_MS = 30 * 60 * 1000;
const SURPRISE_CACHE_TTL_MS = 10 * 60 * 1000;

type DiscoveryCacheEntry = {
  readonly expiresAt: number;
  readonly results: readonly SearchResult[];
};

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
    const task = loader(signal).then((results) => {
      this.cache.set(key, {
        expiresAt: this.now() + DISCOVERY_CACHE_TTL_MS,
        results,
      });
      return results;
    });
    this.inflight.set(key, task);

    const results = await task.finally(() => {
      this.inflight.delete(key);
    });
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
    const task = loader(options, signal).then((results) => {
      this.cache.set(key, {
        expiresAt: this.now() + SURPRISE_CACHE_TTL_MS,
        results,
      });
      return results;
    });
    this.inflight.set(key, task);

    const results = await task.finally(() => {
      this.inflight.delete(key);
    });
    return shuffleResults(results, options.random);
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

async function loadYoutubeSurpriseList(
  _options: CatalogSurpriseLoadOptions,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  // YouTube has no TMDB-style surprise pool — trending is the native spin source.
  return loadYoutubeDiscoveryList(signal);
}

async function loadTmdbDiscoveryList(signal?: AbortSignal): Promise<SearchResult[]> {
  const data = (await fetchTmdbJsonCached(
    "/trending/all/week?language=en-US&page=1",
    signal,
    3500,
  ).catch(() => null)) as Record<string, unknown> | null;
  if (!data) return [];
  const rawResults = Array.isArray(data.results) ? data.results : [];

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
  ).catch(() => null)) as Record<string, unknown> | null;
  if (!data) return [];
  const rawResults = Array.isArray(data.results) ? data.results : [];
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

async function loadAnimeDiscoveryList(signal?: AbortSignal): Promise<SearchResult[]> {
  const gqlQuery = `query{
    Page(page:1, perPage:12){
      media(type:ANIME, sort:TRENDING_DESC, status_not:NOT_YET_RELEASED){
        id
        title{romaji english native}
        coverImage{extraLarge large}
        description(asHtml:false)
        episodes
        averageScore
        popularity
        startDate{year}
        synonyms
      }
    }
  }`;

  const response = await fetch(ANILIST_GRAPHQL_URL, {
    method: "POST",
    signal: signal ?? AbortSignal.timeout(3500),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ query: gqlQuery }),
  }).catch(() => null);
  if (!response?.ok) return [];

  const data = (await response.json()) as {
    readonly data?: {
      readonly Page?: {
        readonly media?: readonly AniListDiscoveryMedia[];
      };
    };
  };

  return (data.data?.Page?.media ?? []).map(anilistMediaToSearchResult);
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
        averageScore
        popularity
        startDate{year}
        synonyms
      }
    }
  }`;

  const response = await fetch(ANILIST_GRAPHQL_URL, {
    method: "POST",
    signal: signal ?? AbortSignal.timeout(3500),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ query: gqlQuery, variables: { page, sort: [sort], genre } }),
  }).catch(() => null);
  if (!response?.ok) return [];

  const data = (await response.json()) as {
    readonly data?: {
      readonly Page?: {
        readonly media?: readonly AniListDiscoveryMedia[];
      };
    };
  };

  return (data.data?.Page?.media ?? []).map((media) => ({
    ...anilistMediaToSearchResult(media),
    metadataSource: `AniList surprise · ${genre ?? "mixed"} · ${sort.toLowerCase().replace("_desc", "")}`,
  }));
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
  readonly averageScore?: number | null;
  readonly popularity?: number | null;
  readonly startDate?: { readonly year?: number | null } | null;
  readonly synonyms?: readonly string[] | null;
};

function anilistMediaToSearchResult(media: AniListDiscoveryMedia): SearchResult {
  const title = media.title?.english || media.title?.romaji || media.title?.native || "Unknown";
  const aliases = buildAniListAliases(title, media);
  const posterPath = media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;

  return {
    id: String(media.id),
    type: "series",
    title,
    titleAliases: aliases,
    year: media.startDate?.year ? String(media.startDate.year) : "",
    overview: stripHtml(media.description ?? "").slice(0, 240),
    posterPath,
    posterSource: posterPath ? "AniList" : undefined,
    metadataSource: "AniList trending",
    rating: typeof media.averageScore === "number" ? media.averageScore / 10 : null,
    popularity: media.popularity ?? null,
    episodeCount: media.episodes ?? undefined,
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

function stripHtml(value: string): string {
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
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
