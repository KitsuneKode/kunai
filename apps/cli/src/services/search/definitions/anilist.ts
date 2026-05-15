import type { SearchIntent } from "@/domain/search/SearchIntent";
import type { SearchMetadata, SearchResult, TitleAlias, TitleInfo } from "@/domain/types";
import { withTimeoutSignal } from "@/infra/abort/timeout-signal";

import type { SearchDeps, SearchService } from "../SearchService";

const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";

type AniListSearchMedia = {
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

export class AniListSearchService implements SearchService {
  readonly metadata: SearchMetadata = {
    id: "anilist",
    name: "AniList",
    description: "AniList GraphQL search and advanced anime discovery",
  };

  readonly compatibleProviders = ["allanime", "allmanga", "miruro", "hianime"];

  constructor(private deps: SearchDeps) {}

  async search(
    query: string,
    signal?: AbortSignal,
    intent?: SearchIntent,
  ): Promise<SearchResult[]> {
    const searchIntent = intent ?? {
      query,
      mode: "anime" as const,
      filters: {},
      sort: "relevance" as const,
    };
    const body = buildAniListSearchRequest(searchIntent);
    this.deps.logger.debug("AniList search", {
      query: searchIntent.query,
      filters: searchIntent.filters,
      sort: searchIntent.sort,
    });

    const response = await fetch(ANILIST_GRAPHQL_URL, {
      method: "POST",
      signal: withTimeoutSignal(signal, 8000),
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`AniList search failed: ${response.status}`);

    const data = (await response.json()) as {
      readonly data?: {
        readonly Page?: {
          readonly media?: readonly AniListSearchMedia[];
        };
      };
    };
    const results = (data.data?.Page?.media ?? []).map(anilistMediaToSearchResult);
    this.deps.logger.info("AniList search complete", {
      query: searchIntent.query,
      count: results.length,
    });
    return results;
  }

  async getTitleDetails(_id: string, _signal?: AbortSignal): Promise<TitleInfo | null> {
    return null;
  }
}

export function createAniListSearchService(deps: SearchDeps): SearchService {
  return new AniListSearchService(deps);
}

export function buildAniListSearchRequest(intent: SearchIntent): {
  readonly query: string;
  readonly variables: Record<string, unknown>;
} {
  const variables: Record<string, unknown> = {
    page: 1,
    sort: [toAniListSort(intent.sort, intent.query)],
  };
  if (intent.query.trim().length > 0) variables.search = intent.query.trim();
  if (intent.filters.genres?.length) {
    variables.genres = intent.filters.genres.map(toAniListGenre);
  }
  if (typeof intent.filters.minRating === "number") {
    variables.score = Math.round(intent.filters.minRating * 10);
  }
  if (typeof intent.filters.year === "number") variables.seasonYear = intent.filters.year;

  return {
    query: `query($page:Int,$search:String,$genres:[String],$seasonYear:Int,$score:Int,$sort:[MediaSort]){
      Page(page:$page, perPage:20){
        media(type:ANIME, search:$search, genre_in:$genres, seasonYear:$seasonYear, averageScore_greater:$score, sort:$sort, status_not:NOT_YET_RELEASED, isAdult:false){
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
    }`,
    variables,
  };
}

function toAniListSort(sort: SearchIntent["sort"], query: string): string {
  if (sort === "rating") return "SCORE_DESC";
  if (sort === "popular") return "POPULARITY_DESC";
  if (sort === "recent") return "START_DATE_DESC";
  return query.trim().length > 0 ? "SEARCH_MATCH" : "TRENDING_DESC";
}

function toAniListGenre(genre: string): string {
  return genre
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function anilistMediaToSearchResult(media: AniListSearchMedia): SearchResult {
  const title = media.title?.english || media.title?.romaji || media.title?.native || "Unknown";
  const posterPath = media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;

  return {
    id: String(media.id),
    type: "series",
    title,
    titleAliases: buildAniListAliases(title, media),
    year: media.startDate?.year ? String(media.startDate.year) : "",
    overview: stripHtml(media.description ?? "").slice(0, 240),
    posterPath,
    posterSource: posterPath ? "AniList" : undefined,
    metadataSource: "AniList search",
    rating: typeof media.averageScore === "number" ? media.averageScore / 10 : null,
    popularity: media.popularity ?? null,
    episodeCount: media.episodes ?? undefined,
  };
}

function buildAniListAliases(providerTitle: string, media: AniListSearchMedia): TitleAlias[] {
  return [
    { kind: "provider", value: providerTitle },
    media.title?.english ? { kind: "english", value: media.title.english } : null,
    media.title?.romaji ? { kind: "romaji", value: media.title.romaji } : null,
    media.title?.native ? { kind: "native", value: media.title.native } : null,
    ...(media.synonyms ?? []).slice(0, 3).map((value): TitleAlias => ({ kind: "synonym", value })),
  ].filter((value): value is TitleAlias => Boolean(value?.value));
}

function stripHtml(value: string): string {
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}
