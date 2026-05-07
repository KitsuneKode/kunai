import type { SearchResult, ShellMode, TitleAlias } from "@/domain/types";

const VIDEASY_TRENDING_URL = "https://db.videasy.net/3/trending/all/week?language=en-US&page=1";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const DISCOVERY_CACHE_TTL_MS = 30 * 60 * 1000;

type DiscoveryCacheEntry = {
  readonly expiresAt: number;
  readonly results: readonly SearchResult[];
};

export type CatalogDiscoveryLoader = (signal?: AbortSignal) => Promise<readonly SearchResult[]>;

export type CatalogDiscoveryLoaders = {
  readonly anime: CatalogDiscoveryLoader;
  readonly tmdb: CatalogDiscoveryLoader;
};

export class CatalogDiscoveryService {
  private readonly cache = new Map<string, DiscoveryCacheEntry>();
  private readonly inflight = new Map<string, Promise<readonly SearchResult[]>>();

  constructor(
    private readonly loaders: CatalogDiscoveryLoaders = {
      anime: loadAnimeDiscoveryList,
      tmdb: loadTmdbDiscoveryList,
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

    const loader = mode === "anime" ? this.loaders.anime : this.loaders.tmdb;
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
}

export function createCatalogDiscoveryService(): CatalogDiscoveryService {
  return new CatalogDiscoveryService();
}

async function loadTmdbDiscoveryList(signal?: AbortSignal): Promise<SearchResult[]> {
  const response = await fetch(VIDEASY_TRENDING_URL, {
    signal: signal ?? AbortSignal.timeout(3500),
  }).catch(() => null);
  if (!response?.ok) return [];

  const data = (await response.json()) as Record<string, unknown>;
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
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
