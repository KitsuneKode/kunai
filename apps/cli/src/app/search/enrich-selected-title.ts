// =============================================================================
// enrich-selected-title.ts — search-select seam for catalog identity parity.
//
// After the user picks a search result (either lane), fill the cross-catalog id
// bag via CatalogIdentityService so the episode picker, provider eligibility,
// history unit, AniSkip (MAL), and IntroDB (TMDB) all see the same identity.
// Cached + bounded (ARM client timeout ≈4s); failures degrade to the original
// title untouched.
// =============================================================================

import { isAnimeContent } from "@/domain/media/content-kind";
import type { ShellMode, TitleInfo } from "@/domain/types";
import type {
  CatalogIdentityEnrichResult,
  CatalogIdentityService,
} from "@/services/catalog/CatalogIdentityService";
import type { MediaKind } from "@kunai/types";

export async function enrichSelectedTitleIdentity(
  catalogIdentityService: Pick<CatalogIdentityService, "enrich">,
  title: TitleInfo,
  mode: ShellMode,
  signal?: AbortSignal,
): Promise<TitleInfo> {
  if (mode === "youtube") return title;

  const anime = mode === "anime" || isAnimeContent(title);
  const kind: MediaKind = anime ? "anime" : title.type === "movie" ? "movie" : "series";
  const year = title.year ? Number.parseInt(title.year, 10) : Number.NaN;

  let result: CatalogIdentityEnrichResult;
  try {
    result = await catalogIdentityService.enrich(
      {
        id: title.id,
        kind,
        title: title.name,
        year: Number.isFinite(year) ? year : undefined,
        externalIds: title.externalIds,
      },
      { signal },
    );
  } catch {
    return title;
  }

  if (!result.externalIds) return title;

  // ARM only catalogs anime: a high-confidence AniList mapping for a TMDB-lane
  // title is authoritative proof the content is anime.
  const armProvenAnime =
    result.graph.source === "arm" &&
    result.graph.confidence === "high" &&
    Boolean(result.graph.anilistId);

  return {
    ...title,
    externalIds: result.externalIds,
    isAnime: title.isAnime || armProvenAnime || undefined,
  };
}
