import type { HistoryProgress } from "@kunai/storage";

import { projectContinuation, type ContinuationDecision } from "./continuation-engine";

export type ContinuationNextRelease = {
  readonly season: number;
  readonly episode: number;
  readonly released: boolean;
  readonly availableAt?: string;
};

export type ContinuationAction =
  | { readonly kind: "resume"; readonly season: number; readonly episode: number }
  | {
      readonly kind: "play-local";
      readonly season: number;
      readonly episode: number;
      readonly jobId?: string;
    }
  | { readonly kind: "select-online"; readonly season: number; readonly episode: number }
  | { readonly kind: "manage-offline" };

export type ContinuationPresentation = {
  readonly badge?: string;
  readonly primaryAction?: ContinuationAction;
  readonly secondaryActions?: readonly ContinuationAction[];
  readonly freshness?: "local" | "cached" | "stale";
};

export type ContinuationProjection = (
  | {
      readonly kind: "resume-unfinished";
      readonly titleId: string;
      readonly title: string;
      readonly season: number;
      readonly episode: number;
      readonly sourceEntry: HistoryProgress;
    }
  | {
      readonly kind: "offline-ready";
      readonly titleId: string;
      readonly title: string;
      readonly season: number;
      readonly episode: number;
      readonly sourceEntry: HistoryProgress;
    }
  | {
      readonly kind: "next-released";
      readonly titleId: string;
      readonly title: string;
      readonly season: number;
      readonly episode: number;
      readonly sourceEntry: HistoryProgress;
    }
  | {
      readonly kind: "new-episodes";
      readonly titleId: string;
      readonly title: string;
      readonly sourceEntry: HistoryProgress;
    }
  | {
      readonly kind: "upcoming";
      readonly titleId: string;
      readonly title: string;
      readonly season: number;
      readonly episode: number;
      readonly availableAt?: string;
      readonly sourceEntry: HistoryProgress;
    }
  | {
      readonly kind: "up-to-date";
      readonly titleId: string;
      readonly title: string;
      readonly sourceEntry: HistoryProgress;
    }
  | {
      readonly kind: "empty";
      readonly titleId: string;
    }
) &
  ContinuationPresentation;

export function projectContinuationState(input: {
  readonly titleId: string;
  readonly entries: readonly [string, HistoryProgress][];
  readonly nextRelease?: ContinuationNextRelease | null;
  readonly releaseProgress?: { readonly newEpisodeCount: number; readonly stale?: boolean } | null;
  readonly offline?: {
    readonly enrolled: boolean;
    readonly readyNextEpisodes: readonly {
      readonly season: number;
      readonly episode: number;
      readonly jobId?: string;
    }[];
  } | null;
}): ContinuationProjection {
  const entries = input.entries
    .filter(([titleId]) => titleId === input.titleId)
    .map(([, entry]) => entry)
    .sort(compareHistoryEntryRecency);

  return projectionFromDecision(
    projectContinuation({
      titleId: input.titleId,
      rows: entries,
      nextRelease: input.nextRelease,
      releaseProgress: input.releaseProgress,
      offline: input.offline,
    }),
    input,
  );
}

function projectionFromDecision(
  decision: ContinuationDecision,
  input: {
    readonly releaseProgress?: {
      readonly newEpisodeCount: number;
      readonly stale?: boolean;
    } | null;
    readonly offline?: { readonly enrolled: boolean } | null;
  },
): ContinuationProjection {
  const sourceEntry = decision.anchor;
  if (!sourceEntry) return { kind: "empty", titleId: decision.titleId };

  if (decision.state === "resume") {
    const season = decision.season ?? sourceEntry.season ?? 1;
    const episode = decision.episode ?? sourceEntry.episode ?? sourceEntry.absoluteEpisode ?? 1;
    return enrichProjection(
      {
        kind: "resume-unfinished",
        titleId: decision.titleId,
        title: decision.title ?? sourceEntry.title,
        season,
        episode,
        sourceEntry,
      },
      input,
      { kind: "resume", season, episode },
    );
  }

  if (decision.state === "offline-ready") {
    const season = decision.season ?? sourceEntry.season ?? 1;
    const episode = decision.episode ?? sourceEntry.episode ?? sourceEntry.absoluteEpisode ?? 1;
    return enrichProjection(
      {
        kind: "offline-ready",
        titleId: decision.titleId,
        title: decision.title ?? sourceEntry.title,
        season,
        episode,
        sourceEntry,
      },
      input,
      {
        kind: "play-local",
        season,
        episode,
        jobId: decision.jobId,
      },
    );
  }

  if (decision.state === "new-episodes") {
    return enrichProjection(
      {
        kind: "new-episodes",
        titleId: decision.titleId,
        title: decision.title ?? sourceEntry.title,
        sourceEntry,
      },
      input,
    );
  }

  if (decision.state === "next-up") {
    const season = decision.season ?? sourceEntry.season ?? 1;
    const episode = decision.episode ?? sourceEntry.episode ?? sourceEntry.absoluteEpisode ?? 1;
    return enrichProjection(
      {
        kind: "next-released",
        titleId: decision.titleId,
        title: decision.title ?? sourceEntry.title,
        season,
        episode,
        sourceEntry,
      },
      input,
      {
        kind: "select-online",
        season,
        episode,
      },
    );
  }

  if (decision.state === "airing-weekly") {
    const season = decision.season ?? sourceEntry.season ?? 1;
    const episode = decision.episode ?? sourceEntry.episode ?? sourceEntry.absoluteEpisode ?? 1;
    return {
      kind: "upcoming",
      titleId: decision.titleId,
      title: decision.title ?? sourceEntry.title,
      season,
      episode,
      availableAt: decision.availableAt,
      sourceEntry,
    };
  }

  return {
    kind: "up-to-date",
    titleId: decision.titleId,
    title: decision.title ?? sourceEntry.title,
    sourceEntry,
  };
}

function enrichProjection<T extends ContinuationProjection>(
  projection: T,
  input: {
    readonly releaseProgress?: {
      readonly newEpisodeCount: number;
      readonly stale?: boolean;
    } | null;
    readonly offline?: { readonly enrolled: boolean } | null;
  },
  action?: ContinuationAction,
): T {
  if (!input.releaseProgress && !input.offline) return projection;
  const badge =
    input.releaseProgress && input.releaseProgress.newEpisodeCount > 0
      ? `${input.releaseProgress.newEpisodeCount} new`
      : undefined;
  return {
    ...projection,
    badge,
    ...(action ? { primaryAction: action } : {}),
    secondaryActions: input.offline?.enrolled ? [{ kind: "manage-offline" }] : [],
    freshness: input.releaseProgress?.stale ? "stale" : input.releaseProgress ? "cached" : "local",
  };
}

function compareHistoryEntryRecency(left: HistoryProgress, right: HistoryProgress): number {
  return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
}
