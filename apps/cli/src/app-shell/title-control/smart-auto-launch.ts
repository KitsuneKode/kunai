import type { EpisodeSelectionResult } from "@/session-flow";

export type PlaybackHistorySnapshot = {
  readonly season?: number | null;
  readonly episode?: number | null;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly completed: boolean;
  /** Anchor of the last-watched episode — needed to build a resume target. */
  readonly absoluteEpisode?: number;
};

export type PlaybackEpisodeEntryContext = {
  readonly titleId: string;
  readonly titleType: "series" | "movie";
  readonly isAnime: boolean;
  readonly launchSource?: "search" | "history" | "continue" | "offline-library" | "notification";
  readonly preselectedEpisode?: { readonly season: number; readonly episode: number };
  readonly history: PlaybackHistorySnapshot | null;
  /**
   * The next unwatched episode when `history` is finished, resolved by the
   * caller through the same loader the starting menu uses. Absent means either
   * not finished, unknown, or nothing left — all of which stay on the menu.
   */
  readonly nextEpisode?: { readonly season: number; readonly episode: number };
  readonly seasonCount?: number;
  readonly failedProvider?: boolean;
  /**
   * The user explicitly asked for the starting-point menu (`m` on the row).
   * Auto-entry exists to make plain Enter resume; an explicit menu request is
   * never overridden by it.
   */
  readonly forceMenu?: boolean;
  readonly flags: { readonly season?: string; readonly episode?: string };
};

export type PlaybackEpisodeEntry =
  | { readonly kind: "auto"; readonly selection: NonNullable<EpisodeSelectionResult> }
  | { readonly kind: "menu" };

const FINISHED_RATIO = 0.95;

function selectedSeason(ctx: PlaybackEpisodeEntryContext): number {
  return ctx.isAnime && ctx.launchSource !== "offline-library"
    ? 1
    : (ctx.preselectedEpisode?.season ?? 1);
}

function historyMatchesSelectedEpisode(ctx: PlaybackEpisodeEntryContext): boolean {
  return (
    ctx.history?.season === selectedSeason(ctx) &&
    ctx.history?.episode === ctx.preselectedEpisode?.episode
  );
}

function isPlaybackFinished(history: PlaybackHistorySnapshot): boolean {
  if (history.completed) return true;
  const duration = history.durationSeconds ?? 0;
  if (duration <= 0) return false;
  return history.positionSeconds / duration >= FINISHED_RATIO;
}

/**
 * The Enter contract: a rested title with a live resume point, or a finished
 * last episode with a known next, plays straight through — no picker. Every
 * other shape is ambiguous (first watch, no saved position, failed provider,
 * explicit menu request) and defers to the starting menu, which stays one key
 * away on `m`.
 */
export function shouldAutoLaunchPlayback(ctx: PlaybackEpisodeEntryContext): boolean {
  if (ctx.titleType !== "series") return false;
  if (ctx.flags.season || ctx.flags.episode) return true;
  // `m` is the user's own request for the menu — it outranks every auto-entry
  // path, including launches that carry an exact episode identity.
  if (ctx.forceMenu) return false;
  // Notification play-now and offline-library both name an exact episode —
  // the identity IS the selection, so a missing history row must not defer to
  // the "Where to start?" menu.
  if (ctx.launchSource === "offline-library" || ctx.launchSource === "notification") {
    return Boolean(ctx.preselectedEpisode);
  }
  if (ctx.failedProvider) return false;
  if (!ctx.preselectedEpisode) {
    // No explicit pick (one-key play): derive the entry from watch history.
    // Unfinished saved position → resume in place; finished → the resolved
    // next unwatched episode when one is known.
    const history = ctx.history;
    if (!history) return false;
    if (history.positionSeconds > 0 && !isPlaybackFinished(history)) return true;
    return isPlaybackFinished(history) && ctx.nextEpisode !== undefined;
  }
  if (!ctx.history || !historyMatchesSelectedEpisode(ctx)) return false;

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
  if (!shouldAutoLaunchPlayback(ctx)) {
    return { kind: "menu" };
  }

  const history = ctx.history;

  // No explicit pick: derive the target from watch history. A live position
  // resumes it (no re-prompt); a finished episode advances to the resolved next.
  if (!ctx.preselectedEpisode) {
    if (!history) return { kind: "menu" };
    if (history.positionSeconds > 0 && !isPlaybackFinished(history)) {
      return {
        kind: "auto",
        selection: {
          season: ctx.isAnime ? 1 : (history.season ?? 1),
          episode: history.episode ?? history.absoluteEpisode ?? 1,
          startAt: history.positionSeconds,
          suppressResumePrompt: true,
        },
      };
    }
    if (ctx.nextEpisode) {
      return {
        kind: "auto",
        selection: { season: ctx.nextEpisode.season, episode: ctx.nextEpisode.episode },
      };
    }
    return { kind: "menu" };
  }

  const season = selectedSeason(ctx);
  const episode = ctx.preselectedEpisode.episode;
  const matchedHistory = historyMatchesSelectedEpisode(ctx) ? history : null;
  if (!matchedHistory) {
    return {
      kind: "auto",
      selection: { season, episode },
    };
  }

  const finished = isPlaybackFinished(matchedHistory);
  if (!finished && matchedHistory.positionSeconds > 0) {
    return {
      kind: "auto",
      selection: {
        season,
        episode,
        startAt: matchedHistory.positionSeconds,
        suppressResumePrompt: true,
      },
    };
  }

  return {
    kind: "auto",
    selection: { season, episode },
  };
}
