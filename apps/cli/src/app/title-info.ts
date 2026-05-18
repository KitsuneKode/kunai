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
    posterUrl: result.posterPath ?? result.artwork?.posterUrl,
    episodeCount: result.episodeCount,
    externalIds: result.externalIds,
    release: result.release,
    artwork: result.artwork,
    languageEvidence: result.languageEvidence,
  };
}
