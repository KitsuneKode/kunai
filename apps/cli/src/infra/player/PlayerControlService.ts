import type { EpisodeInfo, PlaybackTimingMetadata } from "@/domain/types";

import type { LateSubtitleAttachment } from "./PlayerService";

export type PlaybackControlAction =
  | "stop"
  | "refresh"
  | "recover"
  | "fallback"
  | "pick-stream"
  | "pick-source"
  | "pick-quality"
  | "pick-episode"
  | "reload-subtitles"
  | "next"
  | "previous"
  | "back-to-search";

export type PlaybackPickerAction = Extract<
  PlaybackControlAction,
  "pick-stream" | "pick-source" | "pick-quality"
>;

export type PlaybackStreamSelection = {
  readonly sourceId: string | null;
  readonly streamId: string | null;
};

export interface ActivePlayerControl {
  readonly id: string;
  stop(reason?: string): Promise<void>;
  stopCurrentFile?(reason?: string): Promise<void>;
  reloadSubtitles?(): Promise<void>;
  attachSubtitles?(attachment: LateSubtitleAttachment): Promise<number>;
  skipCurrentSegment?(): Promise<boolean>;
  updateTiming?(timing: PlaybackTimingMetadata | null): void;
  getTimingSnapshot?(): PlaybackTimingMetadata | null;
  showOsdMessage?(text: string, durationMs: number): Promise<void>;
  /** Full-window loading overlay via Lua (`user-data/kunai-loading`); survives idle between files. */
  setEpisodeTransitionLoading?(message: string | null): Promise<void>;
}

export interface PlayerControlService {
  setActive(control: ActivePlayerControl | null): void;
  getActive(): ActivePlayerControl | null;
  /** Resolves when a non-null control is registered, or null on timeout/abort. */
  waitForActivePlayer(options: {
    signal?: AbortSignal;
    timeoutMs: number;
  }): Promise<ActivePlayerControl | null>;
  consumeLastAction(): PlaybackControlAction | null;
  /** Signal that a playback action was initiated from inside mpv (e.g. N/P key),
   *  without sending a stop command (mpv handles that itself). */
  signalPlaybackAction(action: PlaybackControlAction): void;
  subscribePickerRequest(listener: (action: PlaybackPickerAction) => void): () => void;
  consumePendingStreamSelection(): PlaybackStreamSelection | null;
  consumePendingEpisodeSelection(): EpisodeInfo | null;
  selectCurrentPlaybackStream(
    action: PlaybackPickerAction,
    selection: PlaybackStreamSelection,
    reason?: string,
  ): Promise<boolean>;
  selectCurrentPlaybackEpisode(episode: EpisodeInfo, reason?: string): Promise<boolean>;
  stopCurrentPlayback(reason?: string): Promise<boolean>;
  refreshCurrentPlayback(reason?: string): Promise<boolean>;
  recoverCurrentPlayback(reason?: string): Promise<boolean>;
  fallbackCurrentPlayback(reason?: string): Promise<boolean>;
  pickStreamCurrentPlayback(reason?: string): Promise<boolean>;
  reloadCurrentSubtitles(reason?: string): Promise<boolean>;
  attachLateSubtitles(attachment: LateSubtitleAttachment, reason?: string): Promise<boolean>;
  skipCurrentSegment(reason?: string): Promise<boolean>;
  pickSourceCurrentPlayback(reason?: string): Promise<boolean>;
  pickQualityCurrentPlayback(reason?: string): Promise<boolean>;
  nextCurrentPlayback(reason?: string): Promise<boolean>;
  previousCurrentPlayback(reason?: string): Promise<boolean>;
  returnToSearchFromPlayback(reason?: string): Promise<boolean>;
  updateCurrentPlaybackTiming(timing: PlaybackTimingMetadata | null, reason?: string): void;
}
