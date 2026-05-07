// =============================================================================
// Player Service Interface
//
// MPV abstraction for media playback.
// =============================================================================

import type { StreamInfo, PlaybackResult } from "@/domain/types";
import type { PlaybackTimingMetadata } from "@/domain/types";
import type { SubtitleTrack } from "@/domain/types";

import type { PlaybackSkipKind } from "./playback-skip";

export type PlayerPlaybackEvent =
  | { type: "launching-player" }
  | { type: "mpv-process-started" }
  | { type: "ipc-connected" }
  | { type: "ipc-command-failed"; command: string; error: string }
  | { type: "ipc-stalled"; command: string; error: string }
  | { type: "opening-stream" }
  | { type: "resolving-playback" }
  | {
      type: "network-buffering";
      percent?: number;
      cacheAheadSeconds?: number;
      cacheSpeed?: number;
    }
  | {
      type: "network-sample";
      cacheAheadSeconds?: number;
      cacheSpeed?: number;
      rawInputRate?: number;
      demuxerViaNetwork?: boolean;
      pausedForCache?: boolean;
      underrun?: boolean;
    }
  | { type: "subtitle-inventory-ready"; trackCount: number }
  | { type: "subtitle-attached"; trackCount: number }
  | { type: "late-subtitles-attached"; trackCount: number }
  | { type: "player-ready" }
  | { type: "playback-started" }
  | {
      type: "stream-stalled";
      secondsWithoutProgress: number;
      /** When set, the stall matched demuxer/network starvation heuristics (see playback-watchdog). */
      stallKind?: "progress" | "network-read-dead";
    }
  | { type: "seek-stalled"; secondsSeeking: number }
  | { type: "player-closing" }
  | { type: "player-closed" }
  | { type: "segment-skipped"; kind: PlaybackSkipKind; automatic: boolean }
  | {
      type: "mpv-in-process-reconnect";
      phase: "started" | "complete" | "failed";
      attempt: number;
      detail?: string;
    };

export interface PlayerOptions {
  url: string;
  headers?: Record<string, string>;
  subtitle?: string;
  subtitleStatus?: string;
  displayTitle: string;
  /** Automatic seek target for this launch. */
  startAt?: number;
  /** Optional resume offer shown in mpv without automatically seeking. */
  resumePromptAt?: number;
  /**
   * When false, skips the mpv “resume here vs start over” prompt for this play.
   * Persistent playback only, when resumePromptAt is positive. Default true.
   */
  resumeStartChoicePrompt?: boolean;
  attach?: boolean;
  playbackMode?: "manual" | "autoplay-chain";
  timing?: PlaybackTimingMetadata | null;
  skipRecap?: boolean;
  skipIntro?: boolean;
  skipPreview?: boolean;
  skipCredits?: boolean;
  onProgress?: (seconds: number) => void;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
  /** Called once when playback enters the last ~30 s (autoplay-chain mode only). */
  onNearEof?: () => void;
}

export interface PlayerService {
  play(stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult>;
  releasePersistentSession(): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export type LateSubtitleAttachment = {
  readonly primarySubtitle?: string | null;
  readonly subtitleTracks?: readonly SubtitleTrack[];
};
