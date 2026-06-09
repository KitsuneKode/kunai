import type { CalendarItem } from "@/domain/calendar/calendar-item";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import type { PostPlayState } from "@/domain/playback/post-play-state";

import type { ResolvedAppCommand, AppCommandId } from "./commands";

export type ShellAction =
  | "command-mode"
  | "setup"
  | "search"
  | "filters"
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
  | "presence"
  | "notifications"
  | "toggle-mode"
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
  | "watch"
  | "download"
  | "downloads"
  | "library"
  | "watchlist"
  | "favorites"
  | "playlist"
  | "playlist-add"
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
  | "clear-history"
  | "export-diagnostics"
  | "report-issue"
  | "provider"
  | "resume-continue-watching"
  | "continue";

export type ShellMode = "series" | "anime";

export type ShellStatusTone = "neutral" | "info" | "success" | "warning" | "error";

export type ShellStatus = {
  label: string;
  tone?: ShellStatusTone;
};

export type ShellFooterMode = "detailed" | "minimal";

export type FooterAction = {
  key: string;
  label: string;
  action: ShellAction;
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
  /** Cross-title queue head label, shown as Up Next when no episode chain remains. */
  readonly queueNextLabel?: string;
  readonly totalEpisodes?: number;
  readonly watchedEpisodes?: number;
  readonly currentSeason?: number;
  /** Next-episode thumbnail for the post-play rail (preferred over the poster). */
  readonly nextEpisodeThumbUrl?: string;
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
  /** Rich catalog metadata for the playing right rail. */
  titleDetail?: import("@/domain/catalog/title-detail").TitleDetail;
  /** Next-episode still for the playing up-next card. */
  nextEpisodeThumbUrl?: string;
  episodeLabel?: string;
  currentSeason?: number;
  onCommandAction?: (action: ShellAction) => void;
  commands?: readonly ResolvedAppCommand[];
  footerMode?: ShellFooterMode;
};

export type BrowseIdleContext = {
  playlistNext?: { title: string; ep?: string };
  continueWatching?: {
    title: string;
    ep?: string;
    remainingLabel?: string;
    titleId?: string;
    mediaKind?: "movie" | "series";
  };
  todayReleaseCount?: number;
  todayReleaseTitleCount?: number;
};

export type BrowseShellOption<T> = {
  value: T;
  label: string;
  detail?: string;
  previewTitle?: string;
  previewMeta?: readonly string[];
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
  revalidate?: Promise<BrowseShellSearchResponse<T>>;
};

export type ShellPanelLine = {
  label: string;
  detail?: string;
  tone?: ShellStatusTone;
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
  | { type: "action"; action: ShellAction }
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
    case "presence":
    case "notifications":
    case "toggle-mode":
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
    case "clear-history":
    case "export-diagnostics":
    case "report-issue":
    case "download":
    case "downloads":
    case "library":
    case "watchlist":
    case "favorites":
    case "playlist":
    case "playlist-add":
    case "stats":
    case "sync":
    case "sync-connect-anilist":
    case "sync-connect-tmdb":
    case "sync-disconnect":
    case "mark-anime":
    case "mark-series":
    case "share":
    case "watch":
    case "continue":
      return commandId;
  }
}
