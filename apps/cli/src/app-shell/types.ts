import type { CalendarItem } from "@/domain/calendar/calendar-item";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import type { PostPlayState } from "@/domain/playback/post-play-state";
import type { ReleaseFilter, WatchFilter } from "@/domain/search/SearchIntent";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

import type { ResolvedAppCommand, AppCommandId } from "./commands";

export type ShellAction =
  | "command-mode"
  | "setup"
  | "search"
  | "filters"
  | "narrow-results"
  | "back-to-search"
  | "trending"
  | "recommendation"
  | "calendar"
  | "anime-calendar"
  | "series-calendar"
  | "random"
  | "surprise"
  | "back-to-results"
  | "settings"
  | "providers"
  | "presence"
  | "telemetry"
  | "telemetry-show"
  | "notifications"
  | "toggle-mode"
  | "series-mode"
  | "anime-mode"
  | "youtube-mode"
  | "quit"
  | "history"
  | "details"
  | "diagnostics"
  | "docs"
  | "help"
  | "about"
  | "update"
  | "image-pane"
  | "toggle-autoplay"
  | "toggle-autoskip"
  | "stop-after-current"
  | "resume"
  | "replay"
  | "recover"
  | "recompute"
  | "fallback"
  | "source"
  | "quality"
  | "audio"
  | "subtitle"
  | "memory"
  | "mark-anime"
  | "mark-series"
  | "share"
  | "bookmark"
  | "follow"
  | "unfollow"
  | "mute"
  | "mark-watched"
  | "mark-unwatched"
  | "mark-season-watched"
  | "mark-up-to-episode"
  | "watch"
  | "download"
  | "downloads"
  | "library"
  | "watchlist"
  | "favorites"
  | "playlists"
  | "up-next"
  | "playlist"
  | "playlist-add"
  | "queue-season"
  | "stats"
  | "sync"
  | "sync-connect-anilist"
  | "sync-connect-tmdb"
  | "sync-disconnect"
  | "pick-episode"
  | "next"
  | "previous"
  | "next-season"
  | "clear-cache"
  | "reset-provider-health"
  | "forget-title-provider-preference"
  | "clear-history"
  | "export-diagnostics"
  | "report-issue"
  | "provider"
  | "resume-continue-watching"
  | "continue"
  | "play-offline-ready"
  | "play-queue-next"
  | "play-local"
  | "watch-online"
  | "menu";

export type ShellMode = "series" | "anime" | "youtube";

export type ShellStatusTone = "neutral" | "info" | "success" | "warning" | "error";

export type ShellStatus = {
  label: string;
  tone?: ShellStatusTone;
};

export type ShellFooterMode = "detailed" | "minimal";

export type FooterAction = {
  key: string;
  label: string;
  /**
   * Dispatchable shell action for footers wired into the keyboard router. Omit
   * for display-only hint rows whose keys are handled by an overlay's own input
   * loop (queue/history/notifications), so the footer can still render the real
   * binding hierarchy without fabricating a router action.
   */
  action?: ShellAction;
  disabled?: boolean;
  reason?: string;
  /** Mark as the single primary action — renders key in amber instead of dim. */
  primary?: boolean;
};

export type PlaybackShellState = {
  mode: ShellMode;
  provider: string;
  title: string;
  type: "movie" | "series";
  season: number;
  episode: number;
  posterUrl?: string;
  subtitleStatus?: string;
  autoplayPaused?: boolean;
  autoskipPaused?: boolean;
  stopAfterCurrent?: boolean;
  resumeLabel?: string;
  showMemory: boolean;
  memoryUsage?: string;
  providerHealth?: ShellPanelLine;
  networkHealth?: ShellPanelLine;
  lastQueuedDownload?: string;
  status?: ShellStatus;
  commands?: readonly ResolvedAppCommand[];
  footerMode?: ShellFooterMode;
  readonly showRecommendationNudge?: boolean;
  readonly recommendationRailItems?: readonly PlaybackRecommendationRailItem[];
  readonly recommendationRailMoreCount?: number;
  readonly postPlayState?: PostPlayState;
  readonly episodeLabel?: string;
  readonly nextEpisodeLabel?: string;
  /** Previous-episode label so the post-play rail can render a PREVIOUS mini-card. */
  readonly previousEpisodeLabel?: string;
  /** Cross-title queue head label, shown as Up Next when no episode chain remains. */
  readonly queueNextLabel?: string;
  /**
   * Exact queue row id snapped with `queueNextLabel` from one `peekNext()`.
   * Post-play Play queued / Enter / n must claim this id — never a reordered head.
   */
  readonly queueNextEntryId?: string;
  readonly totalEpisodes?: number;
  readonly watchedEpisodes?: number;
  readonly currentSeason?: number;
  /** Current episode number — feeds the season-aware media panel art chain. */
  readonly currentEpisode?: number;
  /** Content kind that selects the post-play media-panel layout. */
  readonly contentKind?: import("@/domain/media/content-kind").ContentKind;
  /** YouTube/video metadata for the `video` post-play panel kind. */
  readonly videoMeta?: import("@/domain/types").VideoMeta | null;
  /** Next-episode thumbnail for the post-play rail (preferred over the poster). */
  readonly nextEpisodeThumbUrl?: string;
  /** Previous-episode thumbnail for the post-play PREVIOUS mini-card. */
  readonly previousEpisodeThumbUrl?: string;
  /**
   * Rich catalog metadata + best-of-provider artwork (Agent ART). Optional:
   * surfaces render what is present and show honest placeholders otherwise.
   * Consumed by the Details sheet and the post-play / episode rails.
   */
  readonly titleDetail?: TitleDetail;
};

export type PlaybackRecommendationRailItem = {
  readonly id: string;
  readonly title: string;
  readonly type: "movie" | "series";
  readonly sourceId?: string;
  readonly titleAliases?: import("@/domain/types").SearchResult["titleAliases"];
  readonly year?: string;
  readonly overview?: string;
  readonly posterPath?: string | null;
  readonly episodeCount?: number;
  readonly externalIds?: import("@/domain/types").SearchResult["externalIds"];
  readonly channelId?: string;
  readonly channelTitle?: string;
  readonly contentShape?: import("@/domain/types").SearchResult["contentShape"];
};

export type LoadingShellStage =
  | "finding-stream" // ◐ Resolving
  | "preparing-provider" // ◓ Providers  (new)
  | "preparing-player" // ◑ Stream
  | "starting-playback"; // ◒ Player

export type LoadingShellState = {
  title: string;
  subtitle?: string;
  operation: "resolving" | "playing" | "loading";
  /** High-level stage label for the 4-stage loading UX. */
  stage?: LoadingShellStage;
  /** Human-readable sub-status within the current stage (e.g. "Resolving direct link…"). */
  stageDetail?: string;
  /** Dominant slow startup phase from playback.startup.phases telemetry. */
  dominantPhaseLabel?: string;
  progress?: number; // 0-100 or undefined for indeterminate
  details?: string;
  trace?: string;
  providerName?: string;
  providerId?: string;
  downloadStatus?: string;
  posterUrl?: string;
  subtitleStatus?: string;
  showMemory?: boolean;
  getRuntimeHealth?: () => ShellPanelLine | undefined;
  cancellable?: boolean;
  fallbackAvailable?: boolean;
  /** Alternate provider streams exposed by the current resolve (enables source picker mid-bootstrap). */
  hasStreamCandidates?: boolean;
  autoskipPaused?: boolean;
  autoplayPaused?: boolean;
  isSeriesPlayback?: boolean;
  fallbackProviderName?: string;
  /** Playback supervision telemetry (populated when operation === "playing"). */
  currentPosition?: number;
  duration?: number;
  qualityLabel?: string;
  bufferHealth?: "healthy" | "buffering" | "stalled";
  audioTrack?: string;
  subtitleTrack?: string;
  nextEpisodeLabel?: string;
  previousEpisodeLabel?: string;
  hasNextEpisode?: boolean;
  hasPreviousEpisode?: boolean;
  /** What plays after this — the next episode, else the Up Next queue head. */
  upNextLabel?: string;
  latestIssue?: string | null;
  stopHint?: string;
  controlHint?: string;
  /** Inventory + autoplay/autoskip facts for the playing context strip. */
  playbackFactsStrip?: string;
  /** Active source line (flavor · provider · host). */
  playbackSourceLine?: string;
  /** Compact live-key legend under playback facts. */
  playbackKeysHint?: string;
  /** Hint when both offline and online copies exist for the current episode. */
  sourceToggleHint?: string;
  /** Rich catalog metadata for the playing right rail. */
  titleDetail?: import("@/domain/catalog/title-detail").TitleDetail;
  /** Next-episode still for the playing up-next card. */
  nextEpisodeThumbUrl?: string;
  /** Cross-title queue head label, shown as Up Next when no episode chain remains. */
  queueNextLabel?: string;
  episodeLabel?: string;
  currentSeason?: number;
  /** Current episode number — feeds the season-aware media panel art chain. */
  currentEpisode?: number;
  /** Content kind that selects the media-panel layout (movie/series/anime/video). */
  contentKind?: import("@/domain/media/content-kind").ContentKind;
  /** YouTube/video metadata for the `video` media-panel kind. */
  videoMeta?: import("@/domain/types").VideoMeta | null;
  onCommandAction?: (action: ShellAction) => void;
  commands?: readonly ResolvedAppCommand[];
  footerMode?: ShellFooterMode;
};

export type BrowseIdleContext = {
  playlistNext?: {
    title: string;
    ep?: string;
    titleId: string;
    mediaKind: string;
    season?: number;
    episode?: number;
    absoluteEpisode?: number;
  };
  continueWatching?: {
    title: string;
    ep?: string;
    remainingLabel?: string;
    titleId?: string;
    mediaKind?: "movie" | "series" | "video";
  };
  offlineReadyNext?: {
    title: string;
    ep?: string;
    titleId?: string;
    offlineJobId?: string;
  };
  todayReleaseCount?: number;
  todayReleaseTitleCount?: number;
  calendarNudge?: {
    airingTodayCount: number;
  };
};

export type BrowseIdleContextLoader = () => Promise<BrowseIdleContext | undefined>;

export type BrowseLocalFilterFacts = {
  readonly mediaType?: "movie" | "series";
  readonly contentShape?: "video" | "playlist" | "channel";
  readonly isAnime?: boolean;
  readonly downloaded?: boolean;
  readonly watched?: WatchFilter;
  readonly release?: ReleaseFilter;
  /** Release/air year parsed from the catalog result, for year: filter apply. */
  readonly year?: number;
};

export type BrowseShellOption<T> = {
  value: T;
  label: string;
  detail?: string;
  previewTitle?: string;
  previewMeta?: readonly string[];
  readonly localFilterFacts?: BrowseLocalFilterFacts;
  /** Structured calendar item — calendar renderer reads this instead of strings. */
  calendar?: CalendarItem;
  previewGroup?: string;
  /** ISO date (YYYY-MM-DD) for schedule day dedup and strip labels. */
  previewDayKey?: string;
  previewTime?: string;
  previewBadge?: string;
  previewFacts?: readonly ShellPanelLine[];
  previewImageUrl?: string;
  previewRating?: string;
  previewBody?: string;
  previewNote?: string;
};

export type BrowseShellSearchResponse<T> = {
  options: readonly BrowseShellOption<T>[];
  subtitle: string;
  emptyMessage?: string;
  upstreamFilterBadges?: readonly string[];
  localFilterBadges?: readonly string[];
  unsupportedFilterBadges?: readonly string[];
  /** Calm parser corrections/warnings surfaced in the shell (e.g. type:anime alias). */
  warnings?: readonly string[];
  revalidate?: Promise<BrowseShellSearchResponse<T>>;
};

export type ShellPanelLine = {
  label: string;
  detail?: string;
  tone?: ShellStatusTone;
  /** Diagnostics span header target for expand/collapse. */
  spanId?: string;
};

export type ShellPickerOption<T> = {
  value: T;
  label: string;
  detail?: string;
  previewBody?: string;
  previewImageUrl?: string;
  tone?: ShellStatusTone;
  badge?: string;
  /** Title used for poster initials in history picker rows. */
  posterTitle?: string;
  /** Colored █░ progress bar rendered under history picker rows. */
  historyProgress?: { readonly percentage: number; readonly completed: boolean };
};

export type BrowseShellResult<T> =
  | { type: "selected"; value: T }
  | { type: "action"; action: ShellAction; value?: T }
  | {
      type: "offline-playback";
      launch: { readonly title: TitleInfo; readonly episode?: EpisodeInfo };
    }
  | { type: "cancelled" };

export type PlaybackShellResult =
  | ShellAction
  | {
      readonly type: "track-selection";
      readonly pick: import("@/domain/playback/track-capabilities").DecodedTrackSelection;
    }
  | {
      readonly type: "play-recommendation";
      readonly item: PlaybackRecommendationRailItem;
    }
  | {
      readonly type: "queue-recommendation";
      readonly item: PlaybackRecommendationRailItem;
    }
  | {
      readonly type: "open-recommendation-actions";
      readonly items: readonly PlaybackRecommendationRailItem[];
    }
  | {
      readonly type: "play-queue-entry";
      readonly queueEntryId: string;
    };

export function toShellAction(commandId: AppCommandId): ShellAction {
  switch (commandId) {
    case "search":
    case "filters":
    case "setup":
    case "trending":
    case "recommendation":
    case "calendar":
    case "anime-calendar":
    case "series-calendar":
    case "random":
    case "surprise":
    case "settings":
    case "providers":
    case "presence":
    case "telemetry":
    case "telemetry-show":
    case "notifications":
    case "toggle-mode":
    case "series-mode":
    case "anime-mode":
    case "youtube-mode":
    case "quit":
    case "history":
    case "details":
    case "diagnostics":
    case "docs":
    case "help":
    case "about":
    case "update":
    case "image-pane":
    case "toggle-autoplay":
    case "toggle-autoskip":
    case "stop-after-current":
    case "provider":
    case "replay":
    case "recover":
    case "recompute":
    case "fallback":
    case "source":
    case "quality":
    case "audio":
    case "subtitle":
    case "memory":
    case "pick-episode":
    case "next":
    case "previous":
    case "next-season":
    case "clear-cache":
    case "reset-provider-health":
    case "clear-history":
    case "export-diagnostics":
    case "report-issue":
    case "download":
    case "downloads":
    case "library":
    case "watchlist":
    case "favorites":
    case "playlists":
    case "up-next":
    case "playlist-add":
    case "queue-season":
    case "stats":
    case "sync":
    case "sync-connect-anilist":
    case "sync-connect-tmdb":
    case "sync-disconnect":
    case "mark-anime":
    case "mark-series":
    case "share":
    case "bookmark":
    case "follow":
    case "unfollow":
    case "mute":
    case "mark-watched":
    case "mark-unwatched":
    case "mark-season-watched":
    case "mark-up-to-episode":
    case "watch":
    case "continue":
    case "play-local":
    case "watch-online":
    case "menu":
      return commandId;
  }
}
