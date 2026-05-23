import {
  reconcileContinueHistory,
  type ContinueHistoryRelease,
} from "@/domain/continuation/history-reconciliation";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";

export type RootHistorySelection = {
  titleId: string;
  entry: HistoryEntry;
  targetEpisode?: {
    season: number;
    episode: number;
    reason: "resume" | "new-episode";
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
  readonly entry: HistoryEntry;
  readonly nextRelease?: ContinueHistoryRelease | null;
}): string {
  const decision = reconcileContinueHistory({
    titleId: "history-row",
    entries: [["history-row", input.entry]],
    nextRelease: input.nextRelease ?? null,
  });

  if (decision.kind === "new-episode" && typeof decision.episode === "number") {
    const previousEpisode = input.entry.type === "series" ? input.entry.episode : 0;
    const newSince =
      input.entry.type === "series"
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
): RootHistorySelection {
  if (selection.entry.type !== "series") return selection;
  const decision = reconcileContinueHistory({
    titleId: selection.titleId,
    entries: [[selection.titleId, selection.entry]],
    nextRelease: nextReleases?.get(selection.titleId) ?? null,
  });
  if (decision.kind === "new-episode" && typeof decision.episode === "number") {
    return {
      ...selection,
      targetEpisode: {
        season: decision.season ?? selection.entry.season,
        episode: decision.episode,
        reason: "new-episode",
      },
    };
  }
  return {
    ...selection,
    targetEpisode: {
      season: selection.entry.season,
      episode: selection.entry.episode,
      reason: "resume",
    },
  };
}
