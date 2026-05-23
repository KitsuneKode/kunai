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
  | "fallback"
  | "streams"
  | "source"
  | "quality"
  | "memory"
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
  readonly totalEpisodes?: number;
  readonly watchedEpisodes?: number;
  readonly currentSeason?: number;
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
  autoskipPaused?: boolean;
  autoplayPaused?: boolean;
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
  latestIssue?: string | null;
  stopHint?: string;
  controlHint?: string;
  /** Inventory + autoplay/autoskip facts for the playing context strip. */
  playbackFactsStrip?: string;
  /** Compact live-key legend under playback facts. */
  playbackKeysHint?: string;
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
};

export type BrowseShellOption<T> = {
  value: T;
  label: string;
  detail?: string;
  previewTitle?: string;
  previewMeta?: readonly string[];
  previewGroup?: string;
  previewTime?: string;
  previewBadge?: string;
  /** Release-status for calendar/schedule rows: released · airing-today · upcoming. */
  releaseStatus?: "released" | "airing-today" | "upcoming";
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
    case "fallback":
    case "streams":
    case "source":
    case "quality":
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
    case "continue":
      return commandId;
  }
}
