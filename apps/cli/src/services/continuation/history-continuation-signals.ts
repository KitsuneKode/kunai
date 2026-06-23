import type { CatalogEpisodeBounds } from "@/domain/continuation/catalog-episode-bounds";
import {
  reconcileContinueHistory,
  type ContinueHistoryRelease,
} from "@/domain/continuation/history-reconciliation";
import type { ContinuationSignals } from "@/services/continuation/ContinueWatchingService";
import { historyContentType } from "@/services/continuation/history-progress";
import type { HistoryProgress, ReleaseProgressProjection } from "@kunai/storage";

/** Build continuation signals for a history row, including optimistic next-episode hints. */
export function continuationSignalsForHistoryEntry(input: {
  readonly titleId: string;
  readonly entry: HistoryProgress;
  readonly nextRelease: ContinueHistoryRelease | null | undefined;
  readonly releaseProgress?: ReleaseProgressProjection;
  readonly offline?: ContinuationSignals["offline"];
  readonly catalogBounds?: CatalogEpisodeBounds | null;
}): ContinuationSignals {
  const { titleId, entry, nextRelease, releaseProgress, offline, catalogBounds } = input;

  const cachedNextRelease =
    nextRelease &&
    nextRelease.season !== undefined &&
    nextRelease.episode !== undefined &&
    historyContentType(entry) === "series"
      ? {
          season: nextRelease.season,
          episode: nextRelease.episode,
          released: nextRelease.status === "released",
          availableAt: nextRelease.releaseAt ?? undefined,
        }
      : null;

  const base: ContinuationSignals = {
    nextRelease: cachedNextRelease,
    releaseProgress: releaseProgress
      ? {
          newEpisodeCount: releaseProgress.newEpisodeCount,
          stale: Date.parse(releaseProgress.staleAfterAt) <= Date.now(),
        }
      : null,
    offline: offline ?? null,
  };

  if (releaseProgress || nextRelease) return base;

  const reconcile = reconcileContinueHistory({
    titleId,
    entries: [[titleId, entry]],
    nextRelease: nextRelease ?? null,
    catalogBounds,
  });
  if (
    reconcile.kind === "new-episode" &&
    typeof reconcile.episode === "number" &&
    historyContentType(entry) === "series"
  ) {
    return {
      ...base,
      nextRelease: {
        season: reconcile.season ?? entry.season ?? 1,
        episode: reconcile.episode,
        released: true,
      },
      releaseProgress: { newEpisodeCount: 1 },
    };
  }

  return base;
}
