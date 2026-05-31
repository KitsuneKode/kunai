import type { CatalogReleaseStatus } from "@/services/catalog/CatalogScheduleService";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import { isFinished } from "@/services/persistence/HistoryStore";

export type ContinueHistoryRelease = {
  readonly season?: number;
  readonly episode?: number;
  readonly status: CatalogReleaseStatus;
  readonly releaseAt: string | null;
};

export type ContinueHistoryReconciliationDecision =
  | {
      readonly kind: "resume";
      readonly titleId: string;
      readonly entry: HistoryEntry;
    }
  | {
      readonly kind: "new-episode";
      readonly titleId: string;
      readonly titleName: string;
      readonly season?: number;
      readonly episode?: number;
      readonly previousCompleted: HistoryEntry;
      readonly releaseAt: string | null;
    }
  | {
      readonly kind: "up-to-date";
      readonly titleId: string;
      readonly entry: HistoryEntry;
      readonly nextRelease?: ContinueHistoryRelease;
    }
  | { readonly kind: "empty" };

export function reconcileContinueHistory(input: {
  readonly titleId: string;
  readonly entries: readonly [string, HistoryEntry][];
  readonly nextRelease?: ContinueHistoryRelease | null;
}): ContinueHistoryReconciliationDecision {
  const entries = input.entries
    .filter(([titleId]) => titleId === input.titleId)
    .map(([, entry]) => entry)
    .sort(compareNewestFirst);

  // Netflix/Crunchyroll anchor rule: decide off the MOST-RECENT episode, never
  // scan back to an older abandoned one. Resume it if unfinished, else advance.
  const latest = entries[0];
  if (!latest) return { kind: "empty" };

  if (!isFinished(latest)) {
    return { kind: "resume", titleId: input.titleId, entry: latest };
  }

  if (
    latest.type === "series" &&
    input.nextRelease?.status === "released" &&
    isAfterHistoryEpisode(input.nextRelease, latest)
  ) {
    return {
      kind: "new-episode",
      titleId: input.titleId,
      titleName: latest.title,
      season: input.nextRelease.season,
      episode: input.nextRelease.episode,
      previousCompleted: latest,
      releaseAt: input.nextRelease.releaseAt,
    };
  }

  return {
    kind: "up-to-date",
    titleId: input.titleId,
    entry: latest,
    nextRelease: input.nextRelease ?? undefined,
  };
}

function compareNewestFirst(left: HistoryEntry, right: HistoryEntry): number {
  return (Date.parse(right.watchedAt) || 0) - (Date.parse(left.watchedAt) || 0);
}

function isAfterHistoryEpisode(release: ContinueHistoryRelease, entry: HistoryEntry): boolean {
  if (typeof release.episode !== "number") return false;
  const releaseSeason = release.season ?? entry.season;
  if (releaseSeason > entry.season) return true;
  if (releaseSeason < entry.season) return false;
  return release.episode > entry.episode;
}
