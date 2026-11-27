// The episode to play after a finished one, from the cached release projection
//
// One rule for every continue surface (home row, `--continue`, History,
// Calendar). The release cache knows the latest episode that has aired. When
// the finished anchor is behind it in the same season, the next episode exists:
// that is catalog evidence, not an optimistic E+1. Reconciliation reports such
// a backlog as `caught-up` (it only counts episodes that aired since the last
// watch, so a backlog never notifies), which is why this cannot read `status`
// alone.

import { anchorEpisodeRef } from "@/domain/continuation/catalog-episode-bounds";
import type { ContinueHistoryRelease } from "@/domain/continuation/history-reconciliation";
import type { HistoryProgress, ReleaseProgressProjection } from "@kunai/storage";

import { historyContentType, isFinished } from "./history-progress";

export function continueReleaseFromProjection(
  projection: ReleaseProgressProjection | undefined,
  anchor?: HistoryProgress,
): ContinueHistoryRelease | null {
  if (!projection) return null;

  const position = finishedSeriesPosition(projection, anchor);
  if (position) {
    if (position.episode < position.latestAiredEpisode) {
      return {
        status: "released",
        releaseAt: null,
        season: position.season,
        episode: position.episode + 1,
      };
    }
    // Watched up to what has aired. The projection's own anchor may be older
    // than this history row, so its new-episode target would replay one.
    return scheduledRelease(projection, projection.nextAiringAt ? "upcoming" : "caught-up");
  }

  if (projection.status === "new-episodes" && projection.newEpisodeCount > 0) {
    return {
      status: "released",
      releaseAt: projection.latestKnownReleaseAt ?? null,
      season: projection.anchorSeason ?? projection.latestAiredSeason,
      episode: projection.anchorEpisode + 1,
    };
  }
  return scheduledRelease(
    projection,
    projection.status === "upcoming"
      ? "upcoming"
      : projection.status === "caught-up"
        ? "caught-up"
        : "unknown",
  );
}

/**
 * Where a finished series anchor sits against the latest aired episode, when
 * both are in the same season. A later aired season leaves this season's
 * length unknown, so it gives no answer here.
 */
function finishedSeriesPosition(
  projection: ReleaseProgressProjection,
  anchor: HistoryProgress | undefined,
): { season: number; episode: number; latestAiredEpisode: number } | null {
  if (!anchor || !isFinished(anchor) || historyContentType(anchor) !== "series") return null;
  const latestAiredEpisode = projection.latestAiredEpisode;
  if (latestAiredEpisode === undefined || latestAiredEpisode <= 0) return null;
  const ref = anchorEpisodeRef(anchor);
  if ((projection.latestAiredSeason ?? ref.season) !== ref.season) return null;
  return { season: ref.season, episode: ref.episode, latestAiredEpisode };
}

function scheduledRelease(
  projection: ReleaseProgressProjection,
  status: ContinueHistoryRelease["status"],
): ContinueHistoryRelease {
  return {
    status,
    releaseAt: projection.nextAiringAt ?? null,
    season: projection.nextAiringSeason,
    episode: projection.nextAiringEpisode,
  };
}
