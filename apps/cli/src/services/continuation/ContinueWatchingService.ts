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
  type ContinuationStateKind,
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

export type ContinuationTarget = {
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: "movie" | "series" | "video";
  readonly season?: number;
  readonly episode?: number;
  readonly sourceEntry: HistoryProgress;
};

export type ContinuationPrimaryAction =
  | { readonly kind: "resume-online"; readonly target: ContinuationTarget }
  | { readonly kind: "select-online"; readonly target: ContinuationTarget }
  | { readonly kind: "play-local"; readonly target: ContinuationTarget; readonly jobId?: string }
  | { readonly kind: "manage-offline"; readonly target: ContinuationTarget };

export type ContinuationViewDecision = {
  readonly state: ContinuationStateKind;
  readonly target: ContinuationTarget | null;
  readonly availableAt?: string;
  readonly badge?: string;
  readonly detail?: string;
  readonly primaryAction?: ContinuationPrimaryAction;
  readonly secondaryActions: readonly ContinuationPrimaryAction[];
  readonly freshness: "local" | "cached" | "stale";
};

export type StartupContinuationOptions = {
  readonly scanLimit?: number;
  readonly limit?: number;
  readonly signalsByTitle?: (titleId: string) => ContinuationSignals;
};

/**
 * Repository-backed continuation reads. IO + orchestration only; all decisions
 * delegate to the pure `projectContinuation` engine. Reads local data only and
 * never triggers a network fetch.
 */
export class ContinueWatchingService {
  constructor(private readonly historyRepository: HistoryRepository) {}

  startupCandidate(options: StartupContinuationOptions = {}): ContinuationViewDecision | null {
    return (
      this.recentDecisions({
        limit: options.limit ?? 1,
        scanLimit: options.scanLimit ?? 500,
        signalsByTitle: options.signalsByTitle,
      })[0] ?? null
    );
  }

  recentDecisions(options: StartupContinuationOptions = {}): ContinuationViewDecision[] {
    const anchors = groupLatestByTitle(
      this.historyRepository.listRecent(options.scanLimit ?? 500),
    ).slice(0, options.limit ?? 25);
    return anchors.map((anchor) => {
      const signals = options.signalsByTitle?.(anchor.titleId);
      return this.toViewDecision(
        projectContinuation({
          titleId: anchor.titleId,
          rows: [anchor],
          ...signals,
        }),
        signals,
      );
    });
  }

  titleDecision(titleId: string, signals: ContinuationSignals = {}): ContinuationViewDecision {
    return this.toViewDecision(this.projectTitle(titleId, signals), signals);
  }

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

  private toViewDecision(
    decision: ContinuationDecision,
    signals: ContinuationSignals = {},
  ): ContinuationViewDecision {
    const anchor = decision.anchor;
    if (!anchor) {
      return { state: decision.state, target: null, secondaryActions: [], freshness: "cached" };
    }

    const mediaKind: ContinuationTarget["mediaKind"] =
      anchor.mediaKind === "movie" ? "movie" : anchor.mediaKind === "video" ? "video" : "series";
    const target: ContinuationTarget = {
      titleId: decision.titleId,
      title: decision.title ?? anchor.title,
      mediaKind,
      season: decision.season ?? anchor.season,
      episode: decision.episode ?? anchor.episode ?? anchor.absoluteEpisode,
      sourceEntry: anchor,
    };
    const onlineAction: ContinuationPrimaryAction =
      decision.state === "resume"
        ? { kind: "resume-online", target }
        : { kind: "select-online", target };

    if (decision.state === "offline-ready") {
      return {
        state: decision.state,
        target,
        badge: "downloaded",
        detail: "downloaded copy ready",
        primaryAction: { kind: "play-local", target, jobId: decision.jobId },
        secondaryActions: [onlineAction],
        freshness: "local",
      };
    }

    if (decision.state === "resume" || decision.state === "next-up") {
      return {
        state: decision.state,
        target,
        badge: decision.state === "resume" ? "continue" : "next",
        detail: decision.state === "resume" ? "resume where you left off" : "next episode ready",
        primaryAction: onlineAction,
        secondaryActions: [],
        freshness: freshnessForSignals(signals),
      };
    }

    const hasConcreteOnlineTarget =
      decision.state === "new-episodes" &&
      decision.season !== undefined &&
      decision.episode !== undefined;

    return {
      state: decision.state,
      target,
      availableAt: decision.availableAt,
      badge: decision.state === "new-episodes" ? `${decision.newEpisodeCount ?? 1} new` : undefined,
      detail:
        decision.state === "airing-weekly" ? "next release is not provider-confirmed" : undefined,
      primaryAction: hasConcreteOnlineTarget ? onlineAction : undefined,
      secondaryActions: [],
      freshness: freshnessForSignals(signals),
    };
  }
}

function freshnessForSignals(signals: ContinuationSignals): "local" | "cached" | "stale" {
  return signals.releaseProgress?.stale ? "stale" : "cached";
}
