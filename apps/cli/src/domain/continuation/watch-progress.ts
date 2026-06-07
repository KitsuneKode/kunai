// =============================================================================
// watch-progress.ts — TWO distinct progress projections, never conflated:
//
//   • projectWatchProgress  → EPISODE progress: how far into the *current episode*
//     you are (position / duration). "completed" here means "finished this episode".
//   • projectSeriesProgress → SERIES progress: how far through the *whole series*
//     you are (latest watched episode / latest aired). "seriesCompleted" means
//     you've reached the end of what exists — NOT merely that an episode ended.
//
// The historical bug: finishing one episode set the episode `completed` flag, and
// downstream code read that as the *series* being finished, dropping mid-watch
// series into "Completed". Keeping the two projections separate is the fix.
// =============================================================================

export type WatchProgressInput = {
  readonly timestamp?: number;
  readonly duration?: number;
  readonly completed?: boolean;
};

export type WatchProgressProjection = {
  readonly percentage: number | null;
  readonly completed: boolean;
  readonly inProgress: boolean;
};

export function projectWatchProgress(input: WatchProgressInput): WatchProgressProjection {
  const completed = input.completed === true;
  const timestamp = finiteNonNegative(input.timestamp);
  const duration = finitePositive(input.duration);

  if (!duration) {
    return {
      percentage: completed ? 100 : null,
      completed,
      inProgress: !completed && Boolean(timestamp && timestamp > 10),
    };
  }

  const rawPercentage = Math.round(((timestamp ?? 0) / duration) * 100);
  const percentage = completed ? 100 : Math.max(1, Math.min(99, rawPercentage));
  const inferredCompleted = completed || rawPercentage >= 95;
  return {
    percentage: inferredCompleted ? 100 : percentage,
    completed: inferredCompleted,
    inProgress: !inferredCompleted && Boolean(timestamp && timestamp > 10),
  };
}

export type SeriesProgressInput = {
  /** Latest episode the user has watched (absolute number preferred, else within-season). */
  readonly latestWatchedEpisode?: number | null;
  /** Latest episode known to have aired (from the release projection / catalog). */
  readonly latestAiredEpisode?: number | null;
  /** Whether the user actually finished that latest watched episode (episode-level). */
  readonly episodeFinished: boolean;
};

export type SeriesProgressProjection = {
  readonly episodesWatched: number | null;
  readonly latestAiredEpisode: number | null;
  /** Watched / aired, 0–100. null when the aired total is unknown. */
  readonly percentage: number | null;
  /** Watched up to (or past) the latest aired episode. */
  readonly caughtUp: boolean;
  /** Genuinely done: caught up to the latest aired episode AND finished it. */
  readonly seriesCompleted: boolean;
};

/**
 * SERIES-level progress — deliberately independent of episode position. With no
 * known aired total we cannot claim completion (returns caughtUp/seriesCompleted
 * = false), so a half-watched series is never mislabeled "done".
 */
export function projectSeriesProgress(input: SeriesProgressInput): SeriesProgressProjection {
  const watched = finitePositive(input.latestWatchedEpisode ?? undefined);
  const aired = finitePositive(input.latestAiredEpisode ?? undefined);

  if (!aired || !watched) {
    return {
      episodesWatched: watched,
      latestAiredEpisode: aired,
      percentage: null,
      caughtUp: false,
      seriesCompleted: false,
    };
  }

  const caughtUp = watched >= aired;
  return {
    episodesWatched: watched,
    latestAiredEpisode: aired,
    percentage: Math.max(0, Math.min(100, Math.round((watched / aired) * 100))),
    caughtUp,
    seriesCompleted: caughtUp && input.episodeFinished,
  };
}

function finiteNonNegative(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

function finitePositive(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
