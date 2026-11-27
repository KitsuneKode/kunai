// A continue decision as the launch target the shell and `--continue` play
//
// The selection carries the history row (provider and identity for the
// replay) plus the episode to start, which differs from the row after a
// finished episode.

import type { HistoryProgress } from "@kunai/storage";

import type { ContinuationViewDecision } from "./ContinueWatchingService";

export type HistoryLaunchSelection = {
  readonly titleId: string;
  readonly entry: HistoryProgress;
  readonly targetEpisode?: {
    readonly season: number;
    readonly episode: number;
    readonly reason: "resume" | "new-episode" | "offline-ready";
  };
};

export function historyLaunchSelectionFromContinuation(
  decision: ContinuationViewDecision,
): HistoryLaunchSelection {
  if (!decision.target) throw new Error("Cannot launch an empty continuation decision");
  return {
    titleId: decision.target.titleId,
    entry: decision.target.sourceEntry,
    targetEpisode:
      decision.target.mediaKind === "series" || decision.target.mediaKind === "video"
        ? {
            season: decision.target.season ?? 1,
            episode: decision.target.episode ?? 1,
            reason: continuationTargetReason(decision),
          }
        : undefined,
  };
}

function continuationTargetReason(
  decision: ContinuationViewDecision,
): NonNullable<HistoryLaunchSelection["targetEpisode"]>["reason"] {
  if (decision.primaryAction?.kind === "play-local") return "offline-ready";
  if (decision.primaryAction?.kind === "select-online") return "new-episode";
  return "resume";
}
