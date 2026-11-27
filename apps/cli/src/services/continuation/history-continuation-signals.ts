import type { CatalogEpisodeBounds } from "@/domain/continuation/catalog-episode-bounds";
import type { ContinueHistoryRelease } from "@/domain/continuation/history-reconciliation";
import type { OfflineEpisodeRef } from "@/services/continuation/continuation-engine";
import type { ContinuationSignals } from "@/services/continuation/ContinueWatchingService";
import { historyContentType } from "@/services/continuation/history-progress";
import { continueReleaseFromProjection } from "@/services/continuation/release-next-episode";
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

/**
 * Signals for a title's newest history row from local caches only: the release
 * projection (next aired episode, new season) and any downloaded next episode.
 * `--continue` and the home row both read this, so they pick the same target.
 */
export function cachedContinuationSignals(input: {
  readonly entry: HistoryProgress;
  readonly releaseProgress?: ReleaseProgressProjection;
  readonly offline?: ContinuationSignals["offline"];
}): ContinuationSignals {
  const { entry, releaseProgress } = input;
  const newSeason = releaseProgress?.newSeason;
  return {
    ...continuationSignalsForHistoryEntry({
      titleId: entry.titleId,
      entry,
      nextRelease: continueReleaseFromProjection(releaseProgress, entry),
      releaseProgress,
      offline: input.offline,
    }),
    newSeason: newSeason?.season
      ? { season: newSeason.season, availableAt: newSeason.nextAiringAt }
      : null,
  };
}

/** The offline half of the signals: an enrolled title or a downloaded next episode. */
export function offlineContinuationSignal(
  enrolled: boolean,
  nextReady: OfflineEpisodeRef | undefined,
): ContinuationSignals["offline"] {
  return enrolled || nextReady
    ? { enrolled, readyNextEpisodes: nextReady ? [nextReady] : [] }
    : null;
}
