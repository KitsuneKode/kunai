import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import { isFinished } from "@/services/persistence/HistoryStore";

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
      readonly sourceEntry: HistoryEntry;
    }
  | {
      readonly kind: "offline-ready";
      readonly titleId: string;
      readonly title: string;
      readonly season: number;
      readonly episode: number;
      readonly sourceEntry: HistoryEntry;
    }
  | {
      readonly kind: "next-released";
      readonly titleId: string;
      readonly title: string;
      readonly season: number;
      readonly episode: number;
      readonly sourceEntry: HistoryEntry;
    }
  | {
      readonly kind: "upcoming";
      readonly titleId: string;
      readonly title: string;
      readonly season: number;
      readonly episode: number;
      readonly availableAt?: string;
      readonly sourceEntry: HistoryEntry;
    }
  | {
      readonly kind: "up-to-date";
      readonly titleId: string;
      readonly title: string;
      readonly sourceEntry: HistoryEntry;
    }
  | {
      readonly kind: "empty";
      readonly titleId: string;
    }
) &
  ContinuationPresentation;

export function projectContinuationState(input: {
  readonly titleId: string;
  readonly entries: readonly [string, HistoryEntry][];
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
  const unfinished = entries.find((entry) => !isFinished(entry));
  if (unfinished) {
    return enrichProjection(
      {
        kind: "resume-unfinished",
        titleId: input.titleId,
        title: unfinished.title,
        season: unfinished.season,
        episode: unfinished.episode,
        sourceEntry: unfinished,
      },
      input,
      { kind: "resume", season: unfinished.season, episode: unfinished.episode },
    );
  }

  const latest = entries[0];
  if (!latest) return { kind: "empty", titleId: input.titleId };

  const localNext = input.offline?.readyNextEpisodes
    .filter((episode) => isEpisodeAfter(episode, latest))
    .sort((left, right) => left.season - right.season || left.episode - right.episode)[0];
  if (localNext) {
    return enrichProjection(
      {
        kind: "offline-ready",
        titleId: input.titleId,
        title: latest.title,
        season: localNext.season,
        episode: localNext.episode,
        sourceEntry: latest,
      },
      input,
      {
        kind: "play-local",
        season: localNext.season,
        episode: localNext.episode,
        jobId: localNext.jobId,
      },
    );
  }

  if (input.nextRelease?.released) {
    return enrichProjection(
      {
        kind: "next-released",
        titleId: input.titleId,
        title: latest.title,
        season: input.nextRelease.season,
        episode: input.nextRelease.episode,
        sourceEntry: latest,
      },
      input,
      {
        kind: "select-online",
        season: input.nextRelease.season,
        episode: input.nextRelease.episode,
      },
    );
  }

  if (input.nextRelease) {
    return {
      kind: "upcoming",
      titleId: input.titleId,
      title: latest.title,
      season: input.nextRelease.season,
      episode: input.nextRelease.episode,
      availableAt: input.nextRelease.availableAt,
      sourceEntry: latest,
    };
  }

  return {
    kind: "up-to-date",
    titleId: input.titleId,
    title: latest.title,
    sourceEntry: latest,
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
  action: ContinuationAction,
): T {
  if (!input.releaseProgress && !input.offline) return projection;
  const badge =
    input.releaseProgress && input.releaseProgress.newEpisodeCount > 0
      ? `${input.releaseProgress.newEpisodeCount} new`
      : undefined;
  return {
    ...projection,
    badge,
    primaryAction: action,
    secondaryActions: input.offline?.enrolled ? [{ kind: "manage-offline" }] : [],
    freshness: input.releaseProgress?.stale ? "stale" : input.releaseProgress ? "cached" : "local",
  };
}

function isEpisodeAfter(
  episode: { readonly season: number; readonly episode: number },
  history: HistoryEntry,
): boolean {
  return (
    episode.season > history.season ||
    (episode.season === history.season && episode.episode > history.episode)
  );
}

function compareHistoryEntryRecency(left: HistoryEntry, right: HistoryEntry): number {
  return (Date.parse(right.watchedAt) || 0) - (Date.parse(left.watchedAt) || 0);
}
