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
  readonly mediaKind: "movie" | "series";
  readonly season?: number;
  readonly episode?: number;
  readonly sourceEntry: HistoryProgress;
};

export type ContinuationPrimaryAction =
  | { readonly kind: "resume-online"; readonly target: ContinuationTarget }
  | { readonly kind: "select-online"; readonly target: ContinuationTarget }
  | { readonly kind: "play-local"; readonly target: ContinuationTarget; readonly jobId?: string }
  | { readonly kind: "manage-offline"; readonly target: ContinuationTarget };

export type ContinuationHubGroup =
  | "resume"
  | "offline-ready"
  | "new-episodes"
  | "new-seasons"
  | "airing-upcoming"
  | "up-to-date";

export type ContinuationSourceAvailabilityKind =
  | "local-ready"
  | "online-ready"
  | "both-ready"
  | "local-broken"
  | "online-unknown";

export type ContinuationSourceAvailability = {
  readonly kind: ContinuationSourceAvailabilityKind;
  readonly defaultChoice: "ask-inline" | "local" | "online" | "none";
  readonly localAction?: Extract<ContinuationPrimaryAction, { readonly kind: "play-local" }>;
  readonly onlineAction?: Extract<
    ContinuationPrimaryAction,
    { readonly kind: "resume-online" | "select-online" }
  >;
  readonly manageAction?: Extract<ContinuationPrimaryAction, { readonly kind: "manage-offline" }>;
};

export type ContinuationHubPrimaryAction =
  | ContinuationPrimaryAction
  | {
      readonly kind: "ask-inline";
      readonly target: ContinuationTarget;
      readonly localAction: Extract<ContinuationPrimaryAction, { readonly kind: "play-local" }>;
      readonly onlineAction: Extract<
        ContinuationPrimaryAction,
        { readonly kind: "resume-online" | "select-online" }
      >;
    };

export type ContinuationHubSecondaryAction =
  | ContinuationPrimaryAction
  | { readonly kind: "queue"; readonly target: ContinuationTarget }
  | { readonly kind: "mark-watched"; readonly target: ContinuationTarget };

export type ContinuationHubRow = {
  readonly id: string;
  readonly title: string;
  readonly state: ContinuationStateKind;
  readonly group: ContinuationHubGroup;
  readonly target: ContinuationTarget;
  readonly badge: string;
  readonly detail?: string;
  readonly primaryAction?: ContinuationHubPrimaryAction;
  readonly secondaryActions: readonly ContinuationHubSecondaryAction[];
  readonly freshness: "local" | "cached" | "stale";
  readonly sourceAvailability: ContinuationSourceAvailability;
  readonly updatedAt: string;
};

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

  hubRows(options: StartupContinuationOptions = {}): ContinuationHubRow[] {
    const anchors = groupLatestByTitle(
      this.historyRepository.listRecent(options.scanLimit ?? 500),
    ).slice(0, options.limit ?? 50);
    return anchors.flatMap((anchor) => {
      const signals = options.signalsByTitle?.(anchor.titleId);
      const decision = this.toViewDecision(
        projectContinuation({
          titleId: anchor.titleId,
          rows: [anchor],
          ...signals,
        }),
        signals,
      );
      const row = this.toHubRow(decision, signals);
      return row ? [row] : [];
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

  private toHubRow(
    decision: ContinuationViewDecision,
    signals: ContinuationSignals = {},
  ): ContinuationHubRow | null {
    if (!decision.target) return null;
    const sourceAvailability = sourceAvailabilityForDecision(decision, signals);
    return {
      id: decision.target.titleId,
      title: decision.target.title,
      state: decision.state,
      group: hubGroupForState(decision.state),
      target: decision.target,
      badge: hubBadgeForDecision(decision),
      detail: decision.detail,
      primaryAction: hubPrimaryActionFor(decision, sourceAvailability),
      secondaryActions: hubSecondaryActionsFor(decision, sourceAvailability),
      freshness: decision.freshness,
      sourceAvailability,
      updatedAt: decision.target.sourceEntry.updatedAt,
    };
  }

  private toViewDecision(
    decision: ContinuationDecision,
    signals: ContinuationSignals = {},
  ): ContinuationViewDecision {
    const anchor = decision.anchor;
    if (!anchor) {
      return { state: decision.state, target: null, secondaryActions: [], freshness: "cached" };
    }

    const mediaKind = anchor.mediaKind === "movie" ? "movie" : "series";
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

function hubGroupForState(state: ContinuationStateKind): ContinuationHubGroup {
  switch (state) {
    case "resume":
    case "next-up":
      return "resume";
    case "offline-ready":
      return "offline-ready";
    case "new-episodes":
      return "new-episodes";
    case "new-season":
      return "new-seasons";
    case "airing-weekly":
      return "airing-upcoming";
    case "up-to-date":
    case "empty":
      return "up-to-date";
  }
}

function hubBadgeForDecision(decision: ContinuationViewDecision): string {
  if (decision.badge) return decision.badge;
  switch (decision.state) {
    case "resume":
      return "continue";
    case "next-up":
      return "next";
    case "offline-ready":
      return "downloaded";
    case "new-episodes":
      return "new";
    case "new-season":
      return "new season";
    case "airing-weekly":
      return "upcoming";
    case "up-to-date":
    case "empty":
      return "tracked";
  }
}

function sourceAvailabilityForDecision(
  decision: ContinuationViewDecision,
  signals: ContinuationSignals,
): ContinuationSourceAvailability {
  const localAction = findLocalAction(decision);
  const onlineAction = findOnlineAction(decision);
  const manageAction = decision.target
    ? ({ kind: "manage-offline", target: decision.target } satisfies ContinuationPrimaryAction)
    : undefined;

  if (localAction && onlineAction) {
    return {
      kind: "both-ready",
      defaultChoice: "ask-inline",
      localAction,
      onlineAction,
      manageAction,
    };
  }
  if (localAction) {
    return { kind: "local-ready", defaultChoice: "local", localAction, manageAction };
  }
  if (onlineAction) {
    return {
      kind: signals.offline?.enrolled ? "local-broken" : "online-ready",
      defaultChoice: "online",
      onlineAction,
      manageAction,
    };
  }
  return {
    kind: signals.offline?.enrolled ? "local-broken" : "online-unknown",
    defaultChoice: "none",
    manageAction,
  };
}

function hubPrimaryActionFor(
  decision: ContinuationViewDecision,
  sourceAvailability: ContinuationSourceAvailability,
): ContinuationHubPrimaryAction | undefined {
  if (sourceAvailability.localAction && sourceAvailability.onlineAction && decision.target) {
    return {
      kind: "ask-inline",
      target: decision.target,
      localAction: sourceAvailability.localAction,
      onlineAction: sourceAvailability.onlineAction,
    };
  }
  return decision.primaryAction;
}

function hubSecondaryActionsFor(
  decision: ContinuationViewDecision,
  sourceAvailability: ContinuationSourceAvailability,
): ContinuationHubSecondaryAction[] {
  if (!decision.target) return [];
  const actions: ContinuationHubSecondaryAction[] = [];
  if (sourceAvailability.localAction) actions.push(sourceAvailability.localAction);
  if (sourceAvailability.onlineAction) actions.push(sourceAvailability.onlineAction);
  actions.push({ kind: "queue", target: decision.target });
  actions.push({ kind: "mark-watched", target: decision.target });
  if (sourceAvailability.manageAction) actions.push(sourceAvailability.manageAction);
  return dedupeHubActions(actions);
}

function dedupeHubActions(
  actions: readonly ContinuationHubSecondaryAction[],
): ContinuationHubSecondaryAction[] {
  const seen = new Set<string>();
  const deduped: ContinuationHubSecondaryAction[] = [];
  for (const action of actions) {
    const key =
      action.kind === "play-local"
        ? `${action.kind}:${action.jobId ?? ""}`
        : `${action.kind}:${action.target.titleId}:${action.target.season ?? ""}:${
            action.target.episode ?? ""
          }`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(action);
  }
  return deduped;
}

function findLocalAction(
  decision: ContinuationViewDecision,
): Extract<ContinuationPrimaryAction, { readonly kind: "play-local" }> | undefined {
  const allActions = [decision.primaryAction, ...decision.secondaryActions];
  return allActions.find(
    (action): action is Extract<ContinuationPrimaryAction, { readonly kind: "play-local" }> =>
      action?.kind === "play-local",
  );
}

function findOnlineAction(
  decision: ContinuationViewDecision,
):
  | Extract<ContinuationPrimaryAction, { readonly kind: "resume-online" | "select-online" }>
  | undefined {
  const allActions = [decision.primaryAction, ...decision.secondaryActions];
  return allActions.find(
    (
      action,
    ): action is Extract<
      ContinuationPrimaryAction,
      { readonly kind: "resume-online" | "select-online" }
    > => action?.kind === "resume-online" || action?.kind === "select-online",
  );
}
