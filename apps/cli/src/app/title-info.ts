import { resolveCatalogPosterUrl } from "@/domain/catalog/resolve-catalog-poster-url";
import type { SearchResult, TitleInfo } from "@/domain/types";

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
