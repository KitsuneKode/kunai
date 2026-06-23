import type { SearchResult, TitleAlias } from "@/domain/types";
import { withTimeoutSignal } from "@/infra/abort/timeout-signal";

type AniListTitle = {
  readonly romaji?: string | null;
  readonly english?: string | null;
  readonly native?: string | null;
};

type AniListMedia = {
  readonly id: number;
  readonly title?: AniListTitle | null;
  readonly coverImage?: {
    readonly extraLarge?: string | null;
    readonly large?: string | null;
  } | null;
  readonly bannerImage?: string | null;
  readonly description?: string | null;
  readonly episodes?: number | null;
  readonly averageScore?: number | null;
  readonly popularity?: number | null;
  readonly startDate?: { readonly year?: number | null } | null;
  readonly synonyms?: readonly string[] | null;
};

const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const animeMetadataCache = new Map<string, readonly AniListMedia[]>();

export async function enrichAnimeSearchResultsWithAniList(
  query: string,
  results: readonly SearchResult[],
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  if (results.length === 0) return [...results];

  const media = await fetchAniListSearchPage(query, signal).catch(() => []);
  if (media.length === 0) return [...results];

  const unmatched = new Set(media);
  return results.map((result) => {
    const match = findBestAniListMatch(result, unmatched);
    if (!match) return result;
    unmatched.delete(match);

    const aliases = buildTitleAliases(result.title, match);
    const posterPath = match.coverImage?.extraLarge ?? match.coverImage?.large ?? result.posterPath;

    return {
      ...result,
      titleAliases: mergeTitleAliases(result.titleAliases, aliases),
      year: result.year || (match.startDate?.year ? String(match.startDate.year) : ""),
      overview: result.overview || stripHtml(match.description ?? "").slice(0, 240),
      posterPath: posterPath ?? null,
      posterSource: posterPath ? "AniList" : result.posterSource,
      metadataSource: "AniList",
      rating: result.rating ?? scoreToRating(match.averageScore),
      popularity: result.popularity ?? match.popularity ?? null,
      episodeCount: result.episodeCount ?? match.episodes ?? undefined,
    };
  });
}

async function fetchAniListSearchPage(
  query: string,
  signal?: AbortSignal,
): Promise<readonly AniListMedia[]> {
  const key = query.trim().toLowerCase();
  const cached = animeMetadataCache.get(key);
  if (cached) return cached;

  const gqlQuery = `query($search:String!){
    Page(page:1, perPage:20){
      media(search:$search, type:ANIME, sort:SEARCH_MATCH){
        id
        title{romaji english native}
        coverImage{extraLarge large}
        bannerImage
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
    signal: withTimeoutSignal(signal, 3500),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ query: gqlQuery, variables: { search: query } }),
  });

  if (!response.ok) return [];
  const data = (await response.json()) as {
    readonly data?: { readonly Page?: { readonly media?: readonly AniListMedia[] } };
  };
  const media = data.data?.Page?.media ?? [];
  animeMetadataCache.set(key, media);
  return media;
}

function findBestAniListMatch(
  result: SearchResult,
  candidates: ReadonlySet<AniListMedia>,
): AniListMedia | undefined {
  const wanted = normalizeTitle(result.title);
  for (const candidate of candidates) {
    const names = candidateNames(candidate);
    if (names.some((name) => normalizeTitle(name) === wanted)) return candidate;
  }
  for (const candidate of candidates) {
    const names = candidateNames(candidate);
    if (names.some((name) => titlesOverlap(wanted, normalizeTitle(name)))) return candidate;
  }
  return undefined;
}

function candidateNames(candidate: AniListMedia): string[] {
  return [
    candidate.title?.english,
    candidate.title?.romaji,
    candidate.title?.native,
    ...(candidate.synonyms ?? []),
  ].filter((value): value is string => Boolean(value));
}

function buildTitleAliases(providerTitle: string, media: AniListMedia): TitleAlias[] {
  return [
    { kind: "provider", value: providerTitle },
    media.title?.english ? { kind: "english", value: media.title.english } : null,
    media.title?.romaji ? { kind: "romaji", value: media.title.romaji } : null,
    media.title?.native ? { kind: "native", value: media.title.native } : null,
    ...(media.synonyms ?? []).slice(0, 3).map((value): TitleAlias => ({ kind: "synonym", value })),
  ].filter((value): value is TitleAlias => Boolean(value?.value));
}

function mergeTitleAliases(
  current: readonly TitleAlias[] | undefined,
  next: readonly TitleAlias[],
): TitleAlias[] {
  const seen = new Set<string>();
  const merged: TitleAlias[] = [];
  for (const alias of [...(current ?? []), ...next]) {
    const key = `${alias.kind}:${alias.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(alias);
  }
  return merged;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titlesOverlap(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function stripHtml(value: string): string {
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

function scoreToRating(score: number | null | undefined): number | null {
  return typeof score === "number" && score > 0 ? score / 10 : null;
}
