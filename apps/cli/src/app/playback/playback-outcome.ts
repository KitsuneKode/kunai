import type { QueuePlaybackIntent } from "@/domain/queue/queue-playback-intent";
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
 */
export function playlistAdvanceFromQueueIntent(input: {
  readonly intent: QueuePlaybackIntent;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
}): Extract<PlaybackOutcome, { type: "playlist-advance" }> {
  return {
    type: "playlist-advance",
    titleInfo: {
      id: input.intent.titleId,
      name: input.title,
      type: input.intent.mediaKind === "movie" ? "movie" : "series",
      queuePlaybackIntent: input.intent,
    },
    mode: input.intent.mediaKind === "anime" ? "anime" : "series",
    season: input.season ?? input.intent.season,
    episode: input.episode ?? input.intent.episode,
  };
}
