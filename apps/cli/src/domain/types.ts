// =============================================================================
// Domain Types
//
// Pure business types shared across all layers.
// No dependencies on infrastructure or UI.
// =============================================================================

import type {
  ProviderResolveResult as SharedProviderResolveResult,
  ResolveTrace as SharedResolveTrace,
} from "@kunai/types";

export type { SharedResolveTrace };

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
  readonly episodeCount?: number;
}

export interface EpisodeInfo {
  readonly season: number;
  readonly episode: number;
  readonly name?: string;
  readonly airDate?: string;
  readonly overview?: string;
}

export interface EpisodePickerOption {
  readonly index: number;
  readonly label: string;
  readonly detail?: string;
}

export interface StreamInfo {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly subtitle?: string;
  readonly subtitleList?: SubtitleTrack[];
  readonly subtitleSource?: "direct" | "wyzie" | "provider" | "none";
  readonly subtitleEvidence?: SubtitleEvidence;
  readonly title?: string;
  readonly timestamp: number;
  readonly providerResolveResult?: SharedProviderResolveResult;
  readonly cacheProvenance?: "fresh" | "cached" | "revalidated" | "fallback" | "expired";
}

export interface SubtitleEvidence {
  readonly directSubtitleObserved?: boolean;
  readonly wyzieSearchObserved?: boolean;
  readonly reason?:
    | "direct-file"
    | "provider-default"
    | "wyzie-selected"
    | "wyzie-empty"
    | "wyzie-failed"
    | "not-observed"
    | "cache-refresh-needed";
}

export interface SubtitleTrack {
  readonly url: string;
  readonly display?: string;
  readonly language?: string;
  readonly release?: string;
  readonly sourceKind?: "embedded" | "external";
  readonly sourceName?: string;
  readonly isHearingImpaired?: boolean;
}

export interface SearchResult {
  readonly id: string;
  readonly type: ContentType;
  readonly title: string;
  readonly year: string;
  readonly overview: string;
  readonly posterPath: string | null;
  readonly rating?: number | null;
  readonly popularity?: number | null;
  readonly episodeCount?: number;
}

export type EndReason = "eof" | "quit" | "error" | "unknown";
export type PlaybackTelemetrySource = "ipc" | "unknown";

export interface PlaybackResult {
  readonly watchedSeconds: number;
  readonly duration: number;
  readonly endReason: EndReason;
  readonly resultSource?: PlaybackTelemetrySource;
  readonly playerExitedCleanly?: boolean;
  readonly playerExitCode?: number | null;
  readonly playerExitSignal?: string | null;
  readonly socketPathCleanedUp?: boolean;
  readonly lastNonZeroPositionSeconds?: number;
  readonly lastNonZeroDurationSeconds?: number;
}

export interface PlaybackTimingSegment {
  readonly startMs: number | null;
  readonly endMs: number | null;
}

export interface PlaybackTimingMetadata {
  readonly tmdbId: string;
  readonly type: ContentType;
  readonly intro: readonly PlaybackTimingSegment[];
  readonly recap: readonly PlaybackTimingSegment[];
  readonly credits: readonly PlaybackTimingSegment[];
  readonly preview: readonly PlaybackTimingSegment[];
}

// Metadata for UI display
export interface ProviderMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly recommended: boolean;
  readonly isAnimeProvider: boolean;
  readonly domain?: string;
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
