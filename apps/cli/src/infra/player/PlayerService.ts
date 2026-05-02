// =============================================================================
// Player Service Interface
//
// MPV abstraction for media playback.
// =============================================================================

import type { StreamInfo, PlaybackResult } from "@/domain/types";
import type { PlaybackTimingMetadata } from "@/domain/types";
import type { PlaybackSkipKind } from "./playback-skip";

export type PlayerPlaybackEvent =
  | { type: "launching-player" }
  | { type: "ipc-connected" }
  | { type: "ipc-command-failed"; command: string; error: string }
  | { type: "opening-stream" }
  | { type: "subtitle-inventory-ready"; trackCount: number }
  | { type: "subtitle-attached"; trackCount: number }
  | { type: "player-ready" }
  | { type: "player-closing" }
  | { type: "player-closed" }
  | { type: "segment-skipped"; kind: PlaybackSkipKind; automatic: boolean };

export interface PlayerOptions {
  url: string;
  headers?: Record<string, string>;
  subtitle?: string;
  subtitleStatus?: string;
  displayTitle: string;
  startAt?: number;
  attach?: boolean;
  playbackMode?: "manual" | "autoplay-chain";
  timing?: PlaybackTimingMetadata | null;
  skipRecap?: boolean;
  skipIntro?: boolean;
  skipPreview?: boolean;
  onProgress?: (seconds: number) => void;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
}

export interface PlayerService {
  play(stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult>;
  releasePersistentSession(): Promise<void>;
  isAvailable(): Promise<boolean>;
}
