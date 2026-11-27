// Repository-backed continuation reads
//
// IO + orchestration only; all decisions delegate to the pure projectContinuation
// engine. Reads local data only and never triggers a network fetch.

import { PERSIST_RESUME_SECONDS } from "@/domain/playback/progress-engage-policy";
import type { HistoryProgress, HistoryRepository, HistoryTitleLookup } from "@kunai/storage";

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

export type ContinuationSignalsFor = (
  titleId: string,
  anchor: HistoryProgress,
) => ContinuationSignals;

export type StartupContinuationOptions = {
  readonly scanLimit?: number;
  readonly limit?: number;
  readonly signalsByTitle?: ContinuationSignalsFor;
};

/**
 * The newest title with something to play, from newest-first anchors (one per
 * title, keyed by the id the caller launches with). `accept` lets a surface
 * leave a decision to another row, as the home screen does for downloads.
 */
export function firstPlayableContinuation(
  anchors: ReadonlyArray<readonly [titleId: string, anchor: HistoryProgress]>,
  signalsFor?: ContinuationSignalsFor,
  accept: (decision: ContinuationViewDecision) => boolean = () => true,
): ContinuationViewDecision | null {
  for (const [titleId, anchor] of anchors) {
    const signals = signalsFor?.(titleId, anchor);
    const decision = toViewDecision(
      projectContinuation({ titleId, rows: [{ ...anchor, titleId }], ...signals }),
      signals,
    );
    // A row at or under the resume floor never became a resume point; it is
    // a start that failed, not something to continue.
    if (decision.state === "resume" && anchor.positionSeconds <= PERSIST_RESUME_SECONDS) continue;
    if (decision.target && decision.primaryAction && accept(decision)) return decision;
  }
  return null;
}

/**
 * Repository-backed continuation reads. IO + orchestration only; all decisions
 * delegate to the pure `projectContinuation` engine. Reads local data only and
 * never triggers a network fetch.
 */
export class ContinueWatchingService {
  constructor(private readonly historyRepository: HistoryRepository) {}

  /**
   * The newest title with something to play. Looking only at the newest
   * title made `--continue` give up after a finished movie (or a caught-up
   * show) even with unfinished titles right behind it.
   */
  startupCandidate(options: StartupContinuationOptions = {}): ContinuationViewDecision | null {
    const anchors = groupLatestByTitle(
      this.historyRepository.listRecent(options.scanLimit ?? 500),
    ).slice(0, options.limit ?? 25);
    return firstPlayableContinuation(
      anchors.map((anchor) => [anchor.titleId, anchor] as const),
      options.signalsByTitle,
    );
  }

  titleDecision(titleId: string, signals: ContinuationSignals = {}): ContinuationViewDecision {
    return toViewDecision(this.projectTitle(titleId, signals), signals);
  }

  /** Continuation decision for a single title, anchored on its most-recent episode. */
  projectTitle(
    title: string | HistoryTitleLookup,
    signals: ContinuationSignals = {},
  ): ContinuationDecision {
    const rows =
      typeof title === "string"
        ? this.historyRepository.listByTitle(title)
        : this.historyRepository.listByTitleIdentity(title);
    const titleId = typeof title === "string" ? title : (rows[0]?.titleId ?? title.id);
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
  episodeProgress(title: string | HistoryTitleLookup): readonly HistoryProgress[] {
    return typeof title === "string"
      ? this.historyRepository.listByTitle(title)
      : this.historyRepository.listByTitleIdentity(title);
  }
}

function freshnessForSignals(signals: ContinuationSignals): "local" | "cached" | "stale" {
  return signals.releaseProgress?.stale ? "stale" : "cached";
}

function toViewDecision(
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
