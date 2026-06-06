import {
  reconcileContinueHistory,
  type ContinueHistoryRelease,
} from "@/domain/continuation/history-reconciliation";
import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
import { historyContentType } from "@/services/continuation/history-progress";
import type { HistoryProgress, ReleaseProgressProjection } from "@kunai/storage";

export type RootHistorySelection = {
  titleId: string;
  entry: HistoryProgress;
  localJobId?: string;
  targetEpisode?: {
    season: number;
    episode: number;
    reason: "resume" | "new-episode" | "offline-ready";
  };
};

type HistoryResolver = (value: RootHistorySelection | null) => void;

let pendingResolver: HistoryResolver | null = null;

export function waitForRootHistorySelection(): Promise<RootHistorySelection | null> {
  return new Promise<RootHistorySelection | null>((resolve) => {
    pendingResolver = resolve;
  });
}

export function resolveRootHistorySelection(value: RootHistorySelection | null): void {
  const resolve = pendingResolver;
  pendingResolver = null;
  resolve?.(value);
}

export function hasPendingRootHistorySelection(): boolean {
  return pendingResolver !== null;
}

export function formatNewSinceEpisodeLabel(
  lastWatchedEpisode: number,
  nextEpisode: number,
): string | null {
  if (!Number.isFinite(lastWatchedEpisode) || !Number.isFinite(nextEpisode)) return null;
  if (nextEpisode <= lastWatchedEpisode) return null;
  const delta = nextEpisode - lastWatchedEpisode;
  if (delta === 1) return `new since E${lastWatchedEpisode}`;
  return `${delta} new since E${lastWatchedEpisode}`;
}

export function describeHistoryReturnLoopDetail(input: {
  readonly entry: HistoryProgress;
  readonly nextRelease?: ContinueHistoryRelease | null;
}): string {
  const decision = reconcileContinueHistory({
    titleId: "history-row",
    entries: [["history-row", input.entry]],
    nextRelease: input.nextRelease ?? null,
  });

  if (decision.kind === "new-episode" && typeof decision.episode === "number") {
    const previousEpisode =
      historyContentType(input.entry) === "series"
        ? (input.entry.episode ?? input.entry.absoluteEpisode ?? 1)
        : 0;
    const newSince =
      historyContentType(input.entry) === "series"
        ? formatNewSinceEpisodeLabel(previousEpisode, decision.episode)
        : null;
    return newSince ? `${newSince} · ready when a source resolves` : "new episode ready";
  }

  if (decision.kind === "resume") {
    return "resume where you left off";
  }

  if (decision.kind === "up-to-date") {
    if (input.nextRelease?.status === "upcoming" && input.nextRelease.releaseAt) {
      return "caught up · next release scheduled";
    }
    return "caught up";
  }

  return "pick up from history";
}

export function buildRootHistorySelection(
  selection: RootHistorySelection,
  nextReleases: ReadonlyMap<string, ContinueHistoryRelease> | undefined,
  projections?: ReadonlyMap<string, ContinuationProjection>,
): RootHistorySelection {
  if (historyContentType(selection.entry) !== "series") return selection;
  const action = projections?.get(selection.titleId)?.primaryAction;
  if (action?.kind === "play-local") {
    return {
      ...selection,
      targetEpisode: {
        season: action.season,
        episode: action.episode,
        reason: "offline-ready",
      },
      localJobId: action.jobId,
    };
  }
  const decision = reconcileContinueHistory({
    titleId: selection.titleId,
    entries: [[selection.titleId, selection.entry]],
    nextRelease: nextReleases?.get(selection.titleId) ?? null,
  });
  if (decision.kind === "new-episode" && typeof decision.episode === "number") {
    return {
      ...selection,
      targetEpisode: {
        season: decision.season ?? selection.entry.season ?? 1,
        episode: decision.episode,
        reason: "new-episode",
      },
    };
  }
  return {
    ...selection,
    targetEpisode: {
      season: selection.entry.season ?? 1,
      episode: selection.entry.episode ?? selection.entry.absoluteEpisode ?? 1,
      reason: "resume",
    },
  };
}

export function releaseProgressToContinueHistoryRelease(
  projection: ReleaseProgressProjection | undefined,
): ContinueHistoryRelease | null {
  if (!projection) return null;
  if (projection.status === "new-episodes" && projection.newEpisodeCount > 0) {
    return {
      status: "released",
      releaseAt: projection.latestKnownReleaseAt ?? null,
      season: projection.anchorSeason ?? projection.latestAiredSeason,
      episode: projection.anchorEpisode + 1,
    };
  }
  return {
    status:
      projection.status === "upcoming"
        ? "upcoming"
        : projection.status === "caught-up"
          ? "caught-up"
          : "unknown",
    releaseAt: projection.nextAiringAt ?? null,
    season: projection.nextAiringSeason,
    episode: projection.nextAiringEpisode,
  };
}
