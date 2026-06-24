import {
  buildOfflineAvailabilityIndex,
  type OfflineAvailabilityIndex,
} from "@/domain/playback-source/offline-availability";

import type { OfflineAssetService } from "./OfflineAssetService";

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
): boolean {
  return offlineAssetService
    .listTitleAssets(titleId)
    .some(
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

export function findReadyJobIdForEpisode(
  offlineAssetService: OfflineAssetService,
  titleId: string,
  season: number,
  episode: number,
): string | undefined {
  return offlineAssetService
    .listTitleAssets(titleId)
    .find(
      (asset) => asset.state === "ready" && asset.season === season && asset.episode === episode,
    )?.originJobId;
}
