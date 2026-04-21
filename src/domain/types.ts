// =============================================================================
// Domain Types
//
// Pure business types shared across all layers.
// No dependencies on infrastructure or UI.
// =============================================================================

export type ContentType = "movie" | "series";
export type ShellMode = "series" | "anime";

export interface TitleInfo {
  readonly id: string;
  readonly type: ContentType;
  readonly name: string;
  readonly year?: string;
  readonly overview?: string;
  readonly posterUrl?: string;
  readonly genreIds?: number[];
}

export interface EpisodeInfo {
  readonly season: number;
  readonly episode: number;
  readonly name?: string;
  readonly airDate?: string;
  readonly overview?: string;
}

export interface StreamInfo {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly subtitle?: string;
  readonly subtitleList?: SubtitleTrack[];
  readonly timestamp: number;
}

export interface SubtitleTrack {
  readonly url: string;
  readonly display?: string;
  readonly language?: string;
  readonly release?: string;
}

export interface SearchResult {
  readonly id: string;
  readonly type: ContentType;
  readonly title: string;
  readonly year: string;
  readonly overview: string;
  readonly posterPath: string | null;
}

export interface PlaybackResult {
  readonly watchedSeconds: number;
  readonly duration: number;
  readonly endReason: "eof" | "quit" | "error" | "unknown";
}

// Metadata for UI display
export interface ProviderMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly recommended: boolean;
  readonly isAnimeProvider: boolean;
}

export interface SearchMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

// Capabilities
export interface ProviderCapabilities {
  readonly contentTypes: ContentType[];
}
