import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import { isFinished } from "@/services/persistence/HistoryStore";

export type ContinuationNextRelease = {
  readonly season: number;
  readonly episode: number;
  readonly released: boolean;
  readonly availableAt?: string;
};

export type ContinuationProjection =
  | {
      readonly kind: "resume-unfinished";
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
    };

export function projectContinuationState(input: {
  readonly titleId: string;
  readonly entries: readonly [string, HistoryEntry][];
  readonly nextRelease?: ContinuationNextRelease | null;
}): ContinuationProjection {
  const entries = input.entries
    .filter(([titleId]) => titleId === input.titleId)
    .map(([, entry]) => entry)
    .sort(compareHistoryEntryRecency);
  const unfinished = entries.find((entry) => !isFinished(entry));
  if (unfinished) {
    return {
      kind: "resume-unfinished",
      titleId: input.titleId,
      title: unfinished.title,
      season: unfinished.season,
      episode: unfinished.episode,
      sourceEntry: unfinished,
    };
  }

  const latest = entries[0];
  if (!latest) return { kind: "empty", titleId: input.titleId };

  if (input.nextRelease?.released) {
    return {
      kind: "next-released",
      titleId: input.titleId,
      title: latest.title,
      season: input.nextRelease.season,
      episode: input.nextRelease.episode,
      sourceEntry: latest,
    };
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

function compareHistoryEntryRecency(left: HistoryEntry, right: HistoryEntry): number {
  return (Date.parse(right.watchedAt) || 0) - (Date.parse(left.watchedAt) || 0);
}
