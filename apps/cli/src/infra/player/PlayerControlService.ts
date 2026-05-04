import type { PlaybackTimingMetadata } from "@/domain/types";

import type { LateSubtitleAttachment } from "./PlayerService";

export type PlaybackControlAction =
  | "stop"
  | "refresh"
  | "fallback"
  | "reload-subtitles"
  | "next"
  | "previous";

export interface ActivePlayerControl {
  readonly id: string;
  stop(reason?: string): Promise<void>;
  stopCurrentFile?(reason?: string): Promise<void>;
  reloadSubtitles?(): Promise<void>;
  attachSubtitles?(attachment: LateSubtitleAttachment): Promise<number>;
  skipCurrentSegment?(): Promise<boolean>;
  updateTiming?(timing: PlaybackTimingMetadata | null): void;
  showOsdMessage?(text: string, durationMs: number): Promise<void>;
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
  stopCurrentPlayback(reason?: string): Promise<boolean>;
  refreshCurrentPlayback(reason?: string): Promise<boolean>;
  fallbackCurrentPlayback(reason?: string): Promise<boolean>;
  reloadCurrentSubtitles(reason?: string): Promise<boolean>;
  attachLateSubtitles(attachment: LateSubtitleAttachment, reason?: string): Promise<boolean>;
  skipCurrentSegment(reason?: string): Promise<boolean>;
  nextCurrentPlayback(reason?: string): Promise<boolean>;
  previousCurrentPlayback(reason?: string): Promise<boolean>;
  updateCurrentPlaybackTiming(timing: PlaybackTimingMetadata | null, reason?: string): void;
}
