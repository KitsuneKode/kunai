// =============================================================================
// Player Service Interface
//
// MPV abstraction for media playback.
// =============================================================================

import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import type { PlayerCapabilities } from "@/domain/playback/player-capabilities";
import type { PlaybackResult, ShellMode, StreamInfo, TitleInfo } from "@/domain/types";
import type { PlaybackTimingMetadata } from "@/domain/types";
import type { SubtitleTrack } from "@/domain/types";
import type { DiagnosticCorrelation } from "@/services/diagnostics/correlation";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";

import type { LocalPlaybackPolicyInput } from "./local-playback-policy";
import type { PlaybackSkipKind } from "./playback-skip";

export type PlayerPlaybackEvent =
  | { type: "launching-player" }
  | { type: "media-materialized"; kind: "dash-mpd" | "hls-manifest" }
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
  | {
      type: "stream-slow";
      state: "buffering-observed" | "slow-network-suspected";
      secondsBuffering: number;
      cacheAheadSeconds?: number;
      cacheSpeed?: number;
    }
  | { type: "subtitle-inventory-ready"; trackCount: number }
  | { type: "subtitle-attached"; trackCount: number }
  | { type: "late-subtitles-attached"; trackCount: number }
  | { type: "player-ready" }
  | { type: "playback-started" }
  | { type: "playback-progress"; positionSeconds: number; durationSeconds: number }
  | { type: "playback-paused" }
  | { type: "playback-resumed" }
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
  | { type: "track-changed"; trackType: "audio" | "sub"; id: number }
  | {
      type: "mpv-in-process-reconnect";
      phase: "started" | "complete" | "failed";
      attempt: number;
      detail?: string;
    };

/**
 * The public shape of a player event. `PlayerServiceImpl` is the only place raw
 * `PlayerPlaybackEvent` callbacks are turned into envelopes, so every consumer
 * above it can tell which mpv process/cycle produced the event.
 */
export type PlayerPlaybackEventEnvelope = {
  readonly generation: PlaybackGeneration;
  readonly event: PlayerPlaybackEvent;
};

export interface PlayerOptions {
  url: string;
  headers?: Record<string, string>;
  subtitle?: string;
  subtitleStatus?: string;
  /** Preferred audio language hint for mpv track selection (for example: `orig`, `en`, `ja`, `dub`). */
  audioPreference?: string;
  /** Preferred subtitle language hint for mpv track selection (`none` disables autosub selection). */
  subtitlePreference?: string;
  /** Provider quality preference that produced the current stream; retained for diagnostics/UI symmetry. */
  qualityPreference?: string;
  displayTitle: string;
  correlation?: DiagnosticCorrelation;
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
  autoSkipEnabled?: boolean;
  skipRecap?: boolean;
  skipIntro?: boolean;
  skipPreview?: boolean;
  skipCredits?: boolean;
  onProgress?: (seconds: number) => void;
  onPlayerReady?: () => void;
  /** Fired synchronously, before the first await, with the generation this play owns. */
  onGenerationActivated?: (generation: PlaybackGeneration) => void;
  onPlaybackEvent?: (input: PlayerPlaybackEventEnvelope) => void;
  /** Called once when playback enters the last ~30 s (autoplay-chain mode only). */
  onNearEof?: () => void;
  /** Rejects before spawn; while one-shot playback is active, stops its mpv control. */
  abortSignal?: AbortSignal;
  /**
   * Verified offline source that authorized local filesystem targets for this
   * play. The player matches paths exactly before opting into local URL rules;
   * provider-controlled streams remain remote-only.
   */
  localPlaybackSource?: LocalPlaybackSource;
  shareLinkContext?: {
    readonly mode: ShellMode;
    readonly title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds" | "isAnime">;
    readonly episode?: { readonly season: number; readonly episode: number };
    readonly providerId?: string;
    readonly onCopied?: (result: { readonly url: string; readonly copied: boolean } | null) => void;
  };
}

export interface PlayerService {
  readonly capabilities: PlayerCapabilities;
  play(stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult>;
  releasePersistentSession(): Promise<void>;
  /** Synchronous SIGKILL backstop for `process.on("exit")`. */
  killActiveMpvProcessesSync(): void;
  /** Marks the player as shutting down; blocks new `play()` calls. */
  beginShutdown(): void;
  isAvailable(): Promise<boolean>;
  playLocal(options: {
    source: LocalPlaybackSource;
    attach?: boolean;
    startAt?: number;
    policy?: LocalPlaybackPolicyInput;
    onPlayerReady?: () => void;
    onGenerationActivated?: (generation: PlaybackGeneration) => void;
    onPlaybackEvent?: (input: PlayerPlaybackEventEnvelope) => void;
  }): Promise<PlaybackResult>;
}

export type LateSubtitleAttachment = {
  readonly primarySubtitle?: string | null;
  readonly subtitleTracks?: readonly SubtitleTrack[];
};
