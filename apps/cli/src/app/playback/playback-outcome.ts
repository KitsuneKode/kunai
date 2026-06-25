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
