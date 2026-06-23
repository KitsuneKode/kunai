import { resolveCatalogPosterUrl } from "@/domain/catalog/resolve-catalog-poster-url";
import type { SearchResult, TitleInfo } from "@/domain/types";

export function searchResultFromTitleInfo(title: TitleInfo): SearchResult {
  return {
    id: title.id,
    type: title.type,
    title: title.name,
    titleAliases: title.titleAliases,
    year: title.year ?? "",
    overview: title.overview ?? "",
    posterPath: title.posterUrl ?? null,
    episodeCount: title.episodeCount,
    externalIds: title.externalIds,
    release: title.release,
    artwork: title.artwork,
    languageEvidence: title.languageEvidence,
    metadataSource: title.externalIds?.anilistId ? "AniList history" : undefined,
  };
}

export function titleInfoFromSearchResult(
  result: SearchResult,
  displayName = result.title,
): TitleInfo {
  return {
    id: result.id,
    type: result.type,
    name: displayName,
    titleAliases: result.titleAliases,
    year: result.year,
    overview: result.overview,
    posterUrl: resolveCatalogPosterUrl(result.posterPath ?? result.artwork?.posterUrl) ?? undefined,
    episodeCount: result.episodeCount,
    externalIds: result.externalIds,
    release: result.release,
    artwork: result.artwork,
    languageEvidence: result.languageEvidence,
    isAnime: result.isAnime,
  };
}
