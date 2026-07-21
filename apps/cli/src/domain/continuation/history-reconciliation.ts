import type { CatalogEpisodeBounds } from "@/domain/continuation/catalog-episode-bounds";
import type { CatalogReleaseStatus } from "@/services/catalog/CatalogScheduleService";
import { historyContentType, isFinished } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@kunai/storage";

export type ContinueHistoryRelease = {
  readonly season?: number;
  readonly episode?: number;
  // "caught-up" is an authoritative "you've seen the latest aired episode, nothing
  // new" signal — distinct from "unknown" (no data). Without authoritative release
  // evidence we stay up to date rather than fabricating a phantom next episode.
  readonly status: CatalogReleaseStatus | "caught-up";
  readonly releaseAt: string | null;
};

export type ContinueHistoryReconciliationDecision =
  | {
      readonly kind: "resume";
      readonly titleId: string;
      readonly entry: HistoryProgress;
    }
  | {
      readonly kind: "new-episode";
      readonly titleId: string;
      readonly titleName: string;
      readonly season?: number;
      readonly episode?: number;
      readonly previousCompleted: HistoryProgress;
      readonly releaseAt: string | null;
    }
  | {
      readonly kind: "up-to-date";
      readonly titleId: string;
      readonly entry: HistoryProgress;
      readonly nextRelease?: ContinueHistoryRelease;
    }
  | { readonly kind: "empty" };

export function reconcileContinueHistory(input: {
  readonly titleId: string;
  readonly entries: readonly [string, HistoryProgress][];
  readonly nextRelease?: ContinueHistoryRelease | null;
  readonly catalogBounds?: CatalogEpisodeBounds | null;
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
    historyContentType(latest) === "series" &&
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

  // Conservative policy: finished content without a confirmed released-next signal
  // is up to date. Do not fabricate an unverified E+1 for visible Continue/History.
  // `catalogBounds` remains accepted for call-site compatibility; end-of-catalog
  // gating lives in classifyHistoryBucket / surface policy.
  return {
    kind: "up-to-date",
    titleId: input.titleId,
    entry: latest,
    nextRelease: input.nextRelease ?? undefined,
  };
}

function compareNewestFirst(left: HistoryProgress, right: HistoryProgress): number {
  return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
}

function isAfterHistoryEpisode(release: ContinueHistoryRelease, entry: HistoryProgress): boolean {
  if (typeof release.episode !== "number") return false;
  const entrySeason = entry.season ?? 1;
  const entryEpisode = entry.episode ?? entry.absoluteEpisode ?? 1;
  const releaseSeason = release.season ?? entrySeason;
  if (releaseSeason > entrySeason) return true;
  if (releaseSeason < entrySeason) return false;
  return release.episode > entryEpisode;
}
