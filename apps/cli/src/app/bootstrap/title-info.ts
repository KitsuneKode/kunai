import { resolveCatalogPosterUrl } from "@/domain/catalog/resolve-catalog-poster-url";
import type { SearchResult, TitleInfo } from "@/domain/types";
import { resolveHistoryLookupTitleId } from "@kunai/core";

// Re-export the canonical domain helper so existing bootstrap/search call sites
// keep importing it from here, while the reducer and any other layer share the
// single implementation in domain/media/video-meta.ts.
export { videoMetaFromSearchResult } from "@/domain/media/video-meta";

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

/** Map TitleInfo + shell mode to the canonical history lookup id. */
export function resolveTitleHistoryLookupId(
  title: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">,
  mode?: import("@/domain/types").ShellMode,
): string {
  if (mode === "youtube") {
    return resolveHistoryLookupTitleId({
      id: title.id,
      kind: "video",
      externalIds: title.externalIds,
    });
  }
  const kind =
    mode === "anime" || title.isAnime
      ? ("anime" as const)
      : title.type === "movie"
        ? ("movie" as const)
        : ("series" as const);
  return resolveHistoryLookupTitleId({
    id: title.id,
    kind,
    externalIds: title.externalIds,
  });
}

/** Map a history row to a TitleIdentity-shaped lookup key. */
export function resolveHistoryEntryLookupId(entry: {
  readonly titleId: string;
  readonly mediaKind: import("@kunai/types").MediaKind;
  readonly externalIds?: import("@kunai/types").ProviderExternalIds;
}): string {
  return resolveHistoryLookupTitleId({
    id: entry.titleId,
    kind: entry.mediaKind,
    externalIds: entry.externalIds,
  });
}
