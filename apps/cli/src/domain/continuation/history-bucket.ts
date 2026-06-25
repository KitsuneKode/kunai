// =============================================================================
// history-bucket.ts — single authority for the /history tab a title belongs in.
//
// Replaces the corrupted classification that ran off `reconcileContinueHistory`'s
// OPTIMISTIC fallback (which fabricated a `new-episode` whenever release data was
// missing) combined with the lossy `caught-up → unknown` status collapse. The net
// effect was that caught-up and completed titles flooded "New episodes" and were
// kicked out of "Completed". This classifier decides off the AUTHORITATIVE release
// status (new-episodes | caught-up | upcoming | unknown) instead of fabricating.
//
// Decided model (user, 2026-06-06):
//   • In-progress (movie or series)                        → continue
//   • Finished movie                                       → completed
//   • Finished series + a NEW episode aired since you last
//     watched (status new-episodes AND release after last  → new-episodes
//     watch — "freshly dropped for something you follow")
//   • Finished series + aired delta that is NOT fresh
//     (a backlog you simply haven't watched yet)           → continue
//   • Finished series + a known, ready next to play
//     (downloaded / confirmed released next)               → continue
//   • Finished series + caught-up / upcoming / unknown
//     (nothing new to watch right now)                     → completed
// =============================================================================

import {
  anchorEpisodeRef,
  isAtOrPastCatalogEnd,
  type CatalogEpisodeBounds,
} from "@/domain/continuation/catalog-episode-bounds";
import { projectSeriesProgress } from "@/domain/continuation/watch-progress";
import { historyContentType, isFinished } from "@/services/continuation/history-progress";
import type { ReleaseProgressStatus } from "@kunai/storage";
import type { HistoryProgress } from "@kunai/storage";

export type HistoryBucket = "continue" | "new-episodes" | "completed";

/**
 * The minimal authoritative release signal the classifier needs. Derived from the
 * cached `ReleaseProgressProjection` — NOT from the lossy `ContinueHistoryRelease`,
 * so the `caught-up` state survives.
 */
export type HistoryReleaseSignal = {
  readonly status: ReleaseProgressStatus;
  readonly newEpisodeCount: number;
  readonly latestKnownReleaseAt?: string | null;
  /** Latest episode known to have aired — lets us tell "watched the finale" from "finished a mid-series episode". */
  readonly latestAiredEpisode?: number | null;
};

/** A new episode is "fresh" when it aired AFTER the user last watched the title. */
export function isFreshlyAiredSinceWatch(
  latestKnownReleaseAt: string | null | undefined,
  lastWatchedAt: string,
): boolean {
  if (!latestKnownReleaseAt) return false;
  const releaseMs = Date.parse(latestKnownReleaseAt);
  const watchedMs = Date.parse(lastWatchedAt);
  if (!Number.isFinite(releaseMs) || !Number.isFinite(watchedMs)) return false;
  return releaseMs > watchedMs;
}

export function classifyHistoryBucket(input: {
  readonly entry: HistoryProgress;
  readonly release: HistoryReleaseSignal | null | undefined;
  /** A genuinely known, playable next episode (offline-ready or confirmed released). */
  readonly hasKnownNextToPlay?: boolean;
  readonly catalogBounds?: CatalogEpisodeBounds | null;
}): HistoryBucket {
  const { entry, release } = input;

  // In-progress always continues — movies and series alike.
  if (!isFinished(entry)) return "continue";

  // A finished movie is simply done.
  if (historyContentType(entry) === "movie") return "completed";

  const anchor = anchorEpisodeRef(entry);
  if (isAtOrPastCatalogEnd(anchor, input.catalogBounds)) {
    return "completed";
  }

  // Finished series episode — decide off the authoritative release status.
  if (release && release.status === "new-episodes" && release.newEpisodeCount > 0) {
    return isFreshlyAiredSinceWatch(release.latestKnownReleaseAt, entry.updatedAt)
      ? "new-episodes"
      : "continue"; // aired delta exists, but it is backlog you fell behind on
  }

  // A known, ready next episode (downloaded or confirmed released) keeps you going
  // even when the release status itself is not "new-episodes".
  if (input.hasKnownNextToPlay) return "continue";

  // SERIES-level completion — distinct from finishing one episode. Only claim
  // "completed" with positive evidence that the watched episode reaches the end of
  // what exists. Finishing episode 8 of 24 is NOT finishing the series.
  const series = projectSeriesProgress({
    latestWatchedEpisode: entry.absoluteEpisode ?? entry.episode ?? null,
    latestAiredEpisode: release?.latestAiredEpisode ?? null,
    episodeFinished: true, // isFinished(entry) is already true at this point
  });
  if (series.seriesCompleted) return "completed";

  // Reconciliation positively says you've seen everything aired (caught-up) or the
  // next episode is merely scheduled (upcoming) → completed for now.
  if (release && (release.status === "caught-up" || release.status === "upcoming")) {
    return "completed";
  }

  // No completion evidence at all (unknown / missing release data, no aired total):
  // a finished EPISODE must NOT masquerade as a finished SERIES. Keep it in continue
  // rather than mislabeling a half-watched series "Completed" (the reported bug).
  return "continue";
}
