import type { CatalogEpisodeBounds } from "@/domain/continuation/catalog-episode-bounds";
import type { ContinueHistoryRelease } from "@/domain/continuation/history-reconciliation";
import type { ContinuationSignals } from "@/services/continuation/ContinueWatchingService";
import { historyContentType } from "@/services/continuation/history-progress";
import type { HistoryProgress, ReleaseProgressProjection } from "@kunai/storage";

/** Build continuation signals for a history row from authoritative release cache only. */
export function continuationSignalsForHistoryEntry(input: {
  readonly titleId: string;
  readonly entry: HistoryProgress;
  readonly nextRelease: ContinueHistoryRelease | null | undefined;
  readonly releaseProgress?: ReleaseProgressProjection;
  readonly offline?: ContinuationSignals["offline"];
  /** Retained for call-site compatibility; surface policy owns catalog end checks. */
  readonly catalogBounds?: CatalogEpisodeBounds | null;
}): ContinuationSignals {
  const { entry, nextRelease, releaseProgress, offline } = input;

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

  return {
    nextRelease: cachedNextRelease,
    releaseProgress: releaseProgress
      ? {
          newEpisodeCount: releaseProgress.newEpisodeCount,
          stale: Date.parse(releaseProgress.staleAfterAt) <= Date.now(),
        }
      : null,
    offline: offline ?? null,
  };
}
