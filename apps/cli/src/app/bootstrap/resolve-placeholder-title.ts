import { applyCatalogDetailToTitle } from "@/domain/catalog/apply-title-detail";
import { isCatalogAddressableTitleId, type TitleDetail } from "@/domain/catalog/title-detail";
import type { ContentType, TitleInfo } from "@/domain/types";
import type { TitleDetailHints } from "@/services/catalog/TitleDetailService";
import { isPlaceholderTitleName } from "@kunai/core";

export type PlaceholderTitleResolverDeps = {
  readonly fetchDetail: (
    id: string,
    type: ContentType,
    signal?: AbortSignal,
    hints?: TitleDetailHints,
  ) => Promise<TitleDetail>;
  readonly signal?: AbortSignal;
};

/**
 * Give a title launched by id a real name before anything durable is written.
 *
 * `PlaybackPhase` resolves the catalog on its own, so playback lanes need this.
 * `--download` does not go through playback: it took the `-i/--id` placeholder
 * straight to the download job, the offline library, and — via
 * `resolveDownloadOutputPath` — the file name on disk. A database can be healed
 * later; a downloaded file called "TMDB 438631.mkv" cannot.
 *
 * Best-effort by construction. Only a placeholder over a catalog-addressable id
 * costs a lookup, and any failure returns the title untouched: a download with
 * an ugly name beats a download that did not happen.
 */
export async function resolvePlaceholderTitle(
  title: TitleInfo,
  deps: PlaceholderTitleResolverDeps,
): Promise<TitleInfo> {
  if (!isPlaceholderTitleName(title.name, title.id)) return title;
  if (!isCatalogAddressableTitleId(title.id)) return title;

  try {
    const detail = await deps.fetchDetail(title.id, title.type, deps.signal, {
      externalIds: title.externalIds,
      isAnime: title.isAnime === true,
    });
    return applyCatalogDetailToTitle(title, detail);
  } catch {
    return title;
  }
}
