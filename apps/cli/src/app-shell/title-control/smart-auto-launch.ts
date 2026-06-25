import type { EpisodeSelectionResult } from "@/session-flow";

export type PlaybackHistorySnapshot = {
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly completed: boolean;
};

export type PlaybackEpisodeEntryContext = {
  readonly titleId: string;
  readonly titleType: "series" | "movie";
  readonly isAnime: boolean;
  readonly launchSource?: "search" | "history" | "continue";
  readonly preselectedEpisode?: { readonly season: number; readonly episode: number };
  readonly history: PlaybackHistorySnapshot | null;
  readonly seasonCount?: number;
  readonly failedProvider?: boolean;
  readonly flags: { readonly season?: string; readonly episode?: string };
};

export type PlaybackEpisodeEntry =
  | { readonly kind: "auto"; readonly selection: NonNullable<EpisodeSelectionResult> }
  | { readonly kind: "menu" };

const FINISHED_RATIO = 0.95;

function isPlaybackFinished(history: PlaybackHistorySnapshot): boolean {
  if (history.completed) return true;
  const duration = history.durationSeconds ?? 0;
  if (duration <= 0) return false;
  return history.positionSeconds / duration >= FINISHED_RATIO;
}

/**
 * Instant launch on a clean resume; defer to the starting menu when the entry is
 * ambiguous (first watch with seasons, no saved position, failed provider).
 */
export function shouldAutoLaunchPlayback(ctx: PlaybackEpisodeEntryContext): boolean {
  if (ctx.titleType !== "series") return false;
  if (ctx.flags.season || ctx.flags.episode) return true;
  if (ctx.failedProvider) return false;
  if (!ctx.preselectedEpisode) return false;
  if (!ctx.history) {
    if (!ctx.isAnime && (ctx.seasonCount ?? 0) > 1) return false;
    return false;
  }

  const finished = isPlaybackFinished(ctx.history);
  const hasSavedPosition = ctx.history.positionSeconds > 0 && !finished;
  if (hasSavedPosition) return true;
  // Finished episodes are ambiguous (next vs replay) — defer to the starting menu.
  if (finished) return false;

  // Ambiguous: history exists but no meaningful resume point.
  return false;
}

export function resolvePlaybackEpisodeEntry(
  ctx: PlaybackEpisodeEntryContext,
): PlaybackEpisodeEntry {
  if (!shouldAutoLaunchPlayback(ctx) || !ctx.preselectedEpisode) {
    return { kind: "menu" };
  }

  const season = ctx.isAnime ? 1 : (ctx.preselectedEpisode.season ?? 1);
  const episode = ctx.preselectedEpisode.episode;
  const history = ctx.history;
  if (!history) {
    return {
      kind: "auto",
      selection: { season, episode },
    };
  }

  const finished = isPlaybackFinished(history);
  if (!finished && history.positionSeconds > 0) {
    return {
      kind: "auto",
      selection: {
        season,
        episode,
        startAt: history.positionSeconds,
        suppressResumePrompt: true,
      },
    };
  }

  return {
    kind: "auto",
    selection: { season, episode },
  };
}
