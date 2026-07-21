import type {
  QueuePlaybackFailureContext,
  QueuePlaybackIntent,
} from "@/domain/queue/queue-playback-intent";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";

/** Terminal outcomes from PlaybackPhase.execute() — shared by the phase and post-play menu. */
export type PlaybackOutcome =
  | "back_to_search"
  | "back_to_results"
  | "back_to_history"
  | "mode_switch"
  | "quit"
  | { type: "browse_route"; route: "calendar" | "random" }
  | { type: "history_entry"; title: TitleInfo; episode?: EpisodeInfo; startSeconds?: number }
  | {
      type: "playlist-advance";
      titleInfo: TitleInfo;
      mode: ShellMode;
      season?: number;
      episode?: number;
    };

/**
 * Build a playlist-advance outcome that carries the exact claimed queue intent
 * on `titleInfo` so the next PlaybackPhase can acknowledge only after mpv starts.
 *
 * Abs-only anime intents (`absoluteEpisode` without season/episode) still produce
 * a synthetic S1E{abs} identity so SessionController can SELECT_EPISODE.
 */
export function playlistAdvanceFromQueueIntent(input: {
  readonly intent: QueuePlaybackIntent;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
}): Extract<PlaybackOutcome, { type: "playlist-advance" }> {
  const absoluteEpisode = input.intent.absoluteEpisode;
  const episode = input.episode ?? input.intent.episode ?? absoluteEpisode;
  const season =
    input.season ?? input.intent.season ?? (absoluteEpisode !== undefined ? 1 : undefined);

  return {
    type: "playlist-advance",
    titleInfo: {
      id: input.intent.titleId,
      name: input.title,
      type: input.intent.mediaKind === "movie" ? "movie" : "series",
      queuePlaybackIntent: input.intent,
    },
    mode: input.intent.mediaKind === "anime" ? "anime" : "series",
    season,
    episode,
  };
}

export type PlaylistAutoNextCountdownResult =
  | {
      readonly kind: "advance";
      readonly outcome: Extract<PlaybackOutcome, { type: "playlist-advance" }>;
    }
  | {
      readonly kind: "rollback";
      readonly intent: QueuePlaybackIntent;
      readonly failure: QueuePlaybackFailureContext;
    };

/**
 * Decide auto-next handoff vs rollback after a claimed queue row's countdown.
 * Claim (`beginPlayback(exactId)`) happens before countdown; this only resolves
 * the post-countdown branch so unit tests can lock the contract without Ink.
 */
export function resolvePlaylistAutoNextCountdown(input: {
  readonly intent: QueuePlaybackIntent;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly countdown: "cancelled" | "advanced";
  readonly at?: string;
}): PlaylistAutoNextCountdownResult {
  if (input.countdown === "cancelled") {
    return {
      kind: "rollback",
      intent: input.intent,
      failure: {
        code: "playback-aborted",
        stage: "handoff",
        at: input.at ?? new Date().toISOString(),
        detail: "auto-next countdown cancelled",
      },
    };
  }

  return {
    kind: "advance",
    outcome: playlistAdvanceFromQueueIntent({
      intent: input.intent,
      title: input.title,
      season: input.season,
      episode: input.episode,
    }),
  };
}
