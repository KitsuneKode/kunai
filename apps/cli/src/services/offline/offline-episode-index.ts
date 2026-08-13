import { resolveTitleHistoryLookupId } from "@/domain/catalog/title-history-lookup";
import {
  buildOfflineAvailabilityIndex,
  type OfflineAvailabilityIndex,
} from "@/domain/playback-source/offline-availability";
import type { ShellMode, TitleInfo } from "@/domain/types";
import type { OfflineAssetRecord } from "@kunai/storage";

import type { OfflineAssetService } from "./OfflineAssetService";

/** A title id, or every id an asset for that title could be filed under. */
export type OfflineTitleIdQuery = string | readonly string[];

/**
 * Every id an offline asset for `title` could be filed under.
 *
 * `offline_assets.title_id` is written verbatim from `job.titleId`, but every
 * playback read canonicalises first — and `resolveCanonicalCatalogTitleId`
 * rewrites a movie or series carrying a `tmdbId` to `tmdb:<id>`. So the moment
 * a title arrived enriched with external ids, the lookup asked for an id no
 * asset row holds, answered nothing, and the launch reported "Downloaded file
 * unavailable" for a file sitting healthy on disk. The raw id cannot simply be
 * canonicalised at write time either: the job row carries no external ids, so
 * the canonical form is not knowable there.
 *
 * Checking both costs one extra `IN (...)` term and needs no migration.
 */
export function offlineAssetTitleIdCandidates(
  title: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">,
  mode?: ShellMode,
): readonly string[] {
  const canonical = resolveTitleHistoryLookupId(title, mode);
  return canonical === title.id ? [canonical] : [canonical, title.id];
}

function assetsFor(
  offlineAssetService: OfflineAssetService,
  titleId: OfflineTitleIdQuery,
): readonly OfflineAssetRecord[] {
  if (typeof titleId === "string") return offlineAssetService.listTitleAssets(titleId);
  if (titleId.length === 1) return offlineAssetService.listTitleAssets(titleId[0] as string);
  return offlineAssetService.listByTitleIds(titleId);
}

export function buildOfflineEpisodeIndex(
  offlineAssetService: OfflineAssetService,
  titleIds?: readonly string[],
): OfflineAvailabilityIndex {
  const assets =
    titleIds && titleIds.length > 0
      ? offlineAssetService.listByTitleIds(titleIds)
      : offlineAssetService.listByTitleIds([]);
  return buildOfflineAvailabilityIndex(assets);
}

export function isEpisodeDownloaded(
  offlineAssetService: OfflineAssetService,
  titleId: OfflineTitleIdQuery,
  season?: number,
  episode?: number,
): boolean {
  return assetsFor(offlineAssetService, titleId).some(
    (asset) =>
      asset.state === "ready" &&
      (season === undefined || asset.season === season) &&
      (episode === undefined || asset.episode === episode),
  );
}

export function downloadedCountForTitle(
  offlineAssetService: OfflineAssetService,
  titleId: string,
): number {
  return buildOfflineAvailabilityIndex(
    offlineAssetService.listTitleAssets(titleId),
  ).readyCountForTitle(titleId);
}

/**
 * The next downloaded episode after `current`, or null when nothing is ready.
 *
 * The offline launch path must answer episode availability from the library
 * rather than the catalog: returning null unconditionally reads as "series
 * finished" downstream, so a downloaded next episode would never autoplay.
 */
export function findNextReadyEpisode(
  offlineAssetService: OfflineAssetService,
  titleId: OfflineTitleIdQuery,
  current: { readonly season: number; readonly episode: number },
): { readonly season: number; readonly episode: number } | null {
  const candidates = (typeof titleId === "string" ? [titleId] : titleId).filter(Boolean);
  if (candidates.length === 0) return null;
  const found = offlineAssetService
    .listNextReadyByTitleCursors(
      candidates.map((candidate) => ({
        titleId: candidate,
        season: current.season,
        episode: current.episode,
      })),
    )
    .filter((asset) => asset.season != null && asset.episode != null);
  if (found.length === 0) return null;
  // One row per candidate id comes back, so pick the earliest episode rather
  // than whichever id the query happened to order first.
  const next = found.reduce((earliest, asset) =>
    (asset.season ?? 0) < (earliest.season ?? 0) ||
    ((asset.season ?? 0) === (earliest.season ?? 0) &&
      (asset.episode ?? 0) < (earliest.episode ?? 0))
      ? asset
      : earliest,
  );
  if (next.season == null || next.episode == null) return null;
  return { season: next.season, episode: next.episode };
}

export function findReadyJobIdForEpisode(
  offlineAssetService: OfflineAssetService,
  titleId: OfflineTitleIdQuery,
  season: number,
  episode: number,
  options: {
    readonly mediaKind?: "movie" | "series" | "anime" | "video";
  } = {},
): string | undefined {
  return assetsFor(offlineAssetService, titleId).find(
    (asset) =>
      asset.state === "ready" &&
      (options.mediaKind === "movie" || options.mediaKind === "video"
        ? asset.mediaKind === options.mediaKind
        : asset.season === season && asset.episode === episode),
  )?.originJobId;
}
