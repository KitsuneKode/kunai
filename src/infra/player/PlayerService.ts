// =============================================================================
// Player Service Interface
//
// MPV abstraction for media playback.
// =============================================================================

import type { StreamInfo, PlaybackResult } from "../../domain/types";

export interface PlayerOptions {
  url: string;
  headers?: Record<string, string>;
  subtitle?: string;
  displayTitle: string;
  startAt?: number;
  autoNext?: boolean;
  attach?: boolean;
  onProgress?: (seconds: number) => void;
}

export interface PlayerService {
  play(stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult>;
  isAvailable(): Promise<boolean>;
}
