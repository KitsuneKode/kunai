// =============================================================================
// Domain Types
//
// Pure business types shared across all layers.
// No dependencies on infrastructure or UI.
// =============================================================================

import type {
  ProviderArtworkInfo,
  ProviderExternalIds,
  ProviderLanguageEvidence,
  ProviderReleaseInfo,
  ProviderResolveResult as SharedProviderResolveResult,
  ResolveTrace as SharedResolveTrace,
} from "@kunai/types";

import type { CalendarItem } from "./calendar/calendar-item";
import type { QueuePlaybackIntent } from "./queue/queue-playback-intent";

export type { SharedResolveTrace };
export type { CalendarItem };
export type { MediaPreference, MediaPreferenceKind } from "./media/media-preferences";
export type {
  ActiveMediaTrackState,
  LanguageSelectionIntent,
  LanguageSelectionRequest,
  MediaTrackModel,
  PresenceMediaTrackSummary,
  ProviderMediaInventory,
  SelectedMediaTrackState,
} from "./media/media-track-model";
export type { QueuePlaybackIntent };

export type ContentType = "movie" | "series";
export type ShellMode = "series" | "anime" | "youtube";
export type ProviderLane = "anime" | "series" | "youtube";
export type YouTubeLiveStatus = "none" | "live" | "upcoming" | "post_live";
export type YouTubeContentShape = "video" | "playlist" | "channel";

/**
 * YouTube/video metadata captured from the originating {@link SearchResult} at
 * launch. These fields live on `SearchResult` but NOT on `TitleInfo`, and video
 * titles never populate a `TitleDetail`, so the session carries this snapshot to
 * give the `video` media-panel kind a real data source during playback.
 */
export interface VideoMeta {
  readonly channelTitle?: string;
  readonly channelId?: string;
  readonly viewCount?: number;
  readonly publishedAt?: string;
  readonly durationSeconds?: number;
  readonly contentShape?: YouTubeContentShape;
  readonly liveStatus?: YouTubeLiveStatus;
  readonly premium?: boolean;
  readonly paid?: boolean;
}

export interface TitleInfo {
  readonly id: string;
  readonly type: ContentType;
  readonly name: string;
  readonly titleAliases?: readonly TitleAlias[];
  readonly year?: string;
  readonly overview?: string;
  readonly posterUrl?: string;
  readonly externalIds?: ProviderExternalIds;
  readonly release?: ProviderReleaseInfo;
  readonly artwork?: ProviderArtworkInfo;
  readonly languageEvidence?: readonly ProviderLanguageEvidence[];
  readonly genreIds?: number[];
  /** Deterministic anime detection carried from the TMDB classifier — for the persisted content kind only (never routing). */
  readonly isAnime?: boolean;
  readonly episodeCount?: number;
  readonly launchSource?: "search" | "history" | "continue";
  /** Exact queue handoff identity when playback was claimed from the Up Next queue. */
  readonly queuePlaybackIntent?: QueuePlaybackIntent;
}

export interface EpisodeInfo {
  readonly season: number;
  readonly episode: number;
  /** Absolute anime episode identity when season/episode mapping is unavailable or secondary. */
  readonly absoluteEpisode?: number;
  readonly name?: string;
  readonly airDate?: string;
  readonly overview?: string;
  readonly externalIds?: ProviderExternalIds;
  readonly release?: ProviderReleaseInfo;
  readonly artwork?: ProviderArtworkInfo;
}

export interface EpisodePickerOption {
  readonly index: number;
  readonly label: string;
  readonly name?: string;
  readonly detail?: string;
  readonly previewImageUrl?: string;
  /** Total episode count for the series, if known. Used to detect completion. */
  readonly totalEpisodeCount?: number;
}

export interface StreamInfo {
  readonly url: string;
  readonly deferredLocator?: string;
  readonly headers: Record<string, string>;
  readonly audioLanguages?: string[];
  readonly hardSubLanguage?: string;
  readonly subtitle?: string;
  readonly subtitleList?: SubtitleTrack[];
  readonly subtitleSource?: "direct" | "wyzie" | "provider" | "none";
  readonly subtitleEvidence?: SubtitleEvidence;
  readonly title?: string;
  readonly timestamp: number;
  readonly requiresYtdl?: boolean;
  readonly ytdlFormat?: string;
  readonly ytdlRawOptions?: string;
  readonly providerResolveResult?: SharedProviderResolveResult;
  readonly cacheProvenance?:
    | "fresh"
    | "cached"
    | "revalidated"
    | "refetched"
    | "prefetched"
    | "fallback"
    | "expired";
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
    | "search-observed"
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
  readonly titleAliases?: readonly TitleAlias[];
  readonly year: string;
  readonly overview: string;
  readonly posterPath: string | null;
  readonly posterSource?: string;
  readonly metadataSource?: string;
  readonly rating?: number | null;
  readonly popularity?: number | null;
  /** Deterministic anime detection for TMDB rows (anime-classifier). Lets a TMDB result route to anime providers + badge. */
  readonly isAnime?: boolean;
  /** Structured calendar item — the single source of truth for calendar rows. */
  readonly calendar?: CalendarItem;
  readonly episodeCount?: number;
  readonly availableAudioModes?: readonly ("sub" | "dub")[];
  readonly subtitleAvailability?: "hardsub" | "softsub" | "unknown";
  readonly externalIds?: ProviderExternalIds;
  readonly release?: ProviderReleaseInfo;
  readonly artwork?: ProviderArtworkInfo;
  readonly languageEvidence?: readonly ProviderLanguageEvidence[];
  readonly durationSeconds?: number;
  readonly channelTitle?: string;
  readonly channelId?: string;
  readonly viewCount?: number;
  readonly publishedAt?: string;
  readonly liveStatus?: YouTubeLiveStatus;
  readonly premium?: boolean;
  readonly paid?: boolean;
  readonly contentShape?: YouTubeContentShape;
  /** Lane that produced this row at the search-routing boundary (selection prefers this over shell mode). */
  readonly resolvedLane?: ProviderLane;
}

export type TitleAliasKind = "english" | "romaji" | "native" | "provider" | "synonym";

export interface TitleAlias {
  readonly kind: TitleAliasKind;
  readonly value: string;
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
  readonly lastTrustedProgressSeconds?: number;
  /** Most recent position reached through natural playback or user-initiated seek.
   *  Updated on small forward steps AND user seeks (both forward and backward).
   *  Unlike lastTrustedProgressSeconds, this CAN go down when the user seeks backward. */
  readonly lastReliableProgressSeconds?: number;
  /** True when mpv reported EOF but telemetry suggests the network stream died early. */
  readonly suspectedDeadStream?: boolean;
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
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly recommended: boolean;
  readonly isAnimeProvider: boolean;
  readonly isYoutubeProvider: boolean;
  readonly providerLane: ProviderLane;
  readonly catalogIdentity?: "provider-native" | "anilist" | "tmdb";
  readonly status?: "production" | "candidate" | "experimental" | "research";
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
