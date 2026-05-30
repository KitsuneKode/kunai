// =============================================================================
// ContinueWatchingService.ts — repository-backed continuation reads
//
// IO + orchestration only; all decisions delegate to the pure projectContinuation
// engine. Reads local data only and never triggers a network fetch.
// =============================================================================

import type { HistoryProgress, HistoryRepository } from "@kunai/storage";

import {
  groupLatestByTitle,
  projectContinuation,
  type ContinuationDecision,
  type ContinuationNextRelease,
  type NewSeasonSignal,
  type OfflineEpisodeRef,
} from "./continuation-engine";

export type ContinuationSignals = {
  readonly nextRelease?: ContinuationNextRelease | null;
  readonly newSeason?: NewSeasonSignal | null;
  readonly offline?: {
    readonly enrolled: boolean;
    readonly readyNextEpisodes: readonly OfflineEpisodeRef[];
  } | null;
  readonly releaseProgress?: { readonly newEpisodeCount: number; readonly stale?: boolean } | null;
};

/**
 * Repository-backed continuation reads. IO + orchestration only; all decisions
 * delegate to the pure `projectContinuation` engine. Reads local data only and
 * never triggers a network fetch.
 */
export class ContinueWatchingService {
  constructor(private readonly historyRepository: HistoryRepository) {}

  /** Continuation decision for a single title, anchored on its most-recent episode. */
  projectTitle(titleId: string, signals: ContinuationSignals = {}): ContinuationDecision {
    const rows = this.historyRepository.listByTitle(titleId);
    return projectContinuation({ titleId, rows, ...signals });
  }

  /** Continue Watching list: one anchor per title, recency-ordered. */
  recentRow(
    limit: number,
    signalsByTitle?: (titleId: string) => ContinuationSignals,
    scanLimit = 500,
  ): ContinuationDecision[] {
    const anchors = groupLatestByTitle(this.historyRepository.listRecent(scanLimit)).slice(
      0,
      limit,
    );
    return anchors.map((anchor) =>
      projectContinuation({
        titleId: anchor.titleId,
        rows: [anchor],
        ...signalsByTitle?.(anchor.titleId),
      }),
    );
  }

  /** Every stored episode row for a title (for episode-picker progress dots). */
  episodeProgress(titleId: string): readonly HistoryProgress[] {
    return this.historyRepository.listByTitle(titleId);
  }
}
