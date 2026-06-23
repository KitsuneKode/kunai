import {
  anchorEpisodeRef,
  catalogBoundsFromEpisodeCount,
  catalogBoundsFromReleaseProjection,
  type CatalogEpisodeBounds,
} from "@/domain/continuation/catalog-episode-bounds";
import { historyContentType, isFinished } from "@/services/continuation/history-progress";
import type { ReleaseProgressWriter } from "@/services/release-reconciliation/ReleaseProgressWriter";
import type { HistoryProgress, ReleaseProgressProjection } from "@kunai/storage";

export function readCatalogBoundsForHistoryEntries(
  entries: ReadonlyArray<[string, HistoryProgress]>,
  cachedProgress: ReadonlyMap<string, ReleaseProgressProjection>,
  healedEpisodeCounts?: ReadonlyMap<string, number>,
): ReadonlyMap<string, CatalogEpisodeBounds> {
  const bounds = new Map<string, CatalogEpisodeBounds>();
  for (const [titleId, entry] of entries) {
    const fromRelease = catalogBoundsFromReleaseProjection(cachedProgress.get(titleId));
    if (fromRelease) {
      bounds.set(titleId, fromRelease);
      continue;
    }
    const healedCount = healedEpisodeCounts?.get(titleId);
    if (healedCount) {
      const fromHeal = catalogBoundsFromEpisodeCount(entry.season ?? 1, healedCount);
      if (fromHeal) bounds.set(titleId, fromHeal);
    }
  }
  return bounds;
}

export function seedCaughtUpReleaseProgressFromCatalogCount(
  writer: Pick<ReleaseProgressWriter, "upsertOptimistic">,
  entry: HistoryProgress,
  episodeCount: number,
  now: string,
): void {
  if (historyContentType(entry) !== "series" || !isFinished(entry)) return;
  const anchor = anchorEpisodeRef(entry);
  if (anchor.episode < episodeCount) return;

  const projection: ReleaseProgressProjection = {
    titleId: entry.titleId,
    mediaKind: entry.mediaKind,
    source: "tmdb",
    title: entry.title,
    anchorSeason: anchor.season,
    anchorEpisode: anchor.episode,
    latestAiredSeason: anchor.season,
    latestAiredEpisode: episodeCount,
    newEpisodeCount: 0,
    status: "caught-up",
    checkedAt: now,
    nextCheckAt: now,
    staleAfterAt: new Date(Date.parse(now) + 7 * 86_400_000).toISOString(),
    sourceFingerprint: `catalog-count:${episodeCount}`,
    errorCount: 0,
  };
  writer.upsertOptimistic(projection, now);
}
