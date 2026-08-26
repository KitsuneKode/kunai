import {
  buildOfflineAvailabilityIndex,
  type OfflineAvailabilityIndex,
} from "@/domain/playback-source/offline-availability";
import type { EpisodeInfo } from "@/domain/types";
import { providerEpisodeIdentitiesEqual, type ProviderEpisodeIdentity } from "@kunai/types";

import type { OfflineAssetService } from "./OfflineAssetService";

/**
 * Every function here takes the id an asset is actually filed under. Resolve it
 * once at the call site with `OfflineTitleIdentity.resolveForTitle`; writes
 * resolve the same way, so a single id is enough and asking under two was only
 * ever a way to paper over the write and read paths disagreeing.
 */
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
  titleId: string,
  season?: number,
  episode?: number,
  providerEpisodeIdentity?: ProviderEpisodeIdentity,
): boolean {
  return offlineAssetService
    .listTitleAssets(titleId)
    .some(
      (asset) =>
        asset.state === "ready" &&
        (season === undefined || asset.season === season) &&
        (episode === undefined || asset.episode === episode) &&
        (providerEpisodeIdentity === undefined ||
          providerEpisodeIdentitiesEqual(asset.providerEpisodeIdentity, providerEpisodeIdentity)),
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
  titleId: string,
  current: { readonly season: number; readonly episode: number },
): EpisodeInfo | null {
  if (!titleId) return null;
  const next = offlineAssetService
    .listNextReadyByTitleCursors([{ titleId, season: current.season, episode: current.episode }])
    .find(
      (asset) =>
        asset.season !== null &&
        asset.season !== undefined &&
        asset.episode !== null &&
        asset.episode !== undefined,
    );
  if (
    !next ||
    next.season === null ||
    next.season === undefined ||
    next.episode === null ||
    next.episode === undefined
  ) {
    return null;
  }
  return {
    season: next.season,
    episode: next.episode,
    providerEpisodeIdentity: next.providerEpisodeIdentity,
  };
}

export function findReadyJobIdForEpisode(
  offlineAssetService: OfflineAssetService,
  titleId: string,
  season: number,
  episode: number,
  options: {
    readonly mediaKind?: "movie" | "series" | "anime" | "video";
    readonly providerEpisodeIdentity?: ProviderEpisodeIdentity;
  } = {},
): string | undefined {
  return offlineAssetService
    .listTitleAssets(titleId)
    .find(
      (asset) =>
        asset.state === "ready" &&
        (options.mediaKind === "movie" || options.mediaKind === "video"
          ? asset.mediaKind === options.mediaKind
          : asset.season === season && asset.episode === episode) &&
        (options.providerEpisodeIdentity === undefined ||
          providerEpisodeIdentitiesEqual(
            asset.providerEpisodeIdentity,
            options.providerEpisodeIdentity,
          )),
    )?.originJobId;
}
