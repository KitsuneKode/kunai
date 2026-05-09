import type { ResolvedAppCommand, AppCommandId } from "./commands";

export type ShellAction =
  | "command-mode"
  | "setup"
  | "search"
  | "back-to-search"
  | "trending"
  | "recommendation"
  | "back-to-results"
  | "settings"
  | "presence"
  | "toggle-mode"
  | "quit"
  | "history"
  | "details"
  | "diagnostics"
  | "help"
  | "about"
  | "image-pane"
  | "toggle-autoplay"
  | "toggle-autoskip"
  | "resume"
  | "replay"
  | "recover"
  | "fallback"
  | "streams"
  | "source"
  | "quality"
  | "download"
  | "downloads"
  | "pick-episode"
  | "next"
  | "previous"
  | "next-season"
  | "clear-cache"
  | "clear-history"
  | "export-diagnostics"
  | "report-issue"
  | "provider";

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
  readonly recommendationRailItems?: readonly string[];
  readonly recommendationRailMoreCount?: number;
};

export type LoadingShellState = {
  title: string;
  subtitle?: string;
  operation: "searching" | "scraping" | "resolving" | "playing" | "loading";
  progress?: number; // 0-100 or undefined for indeterminate
  details?: string;
  trace?: string;
  downloadStatus?: string;
  subtitleStatus?: string;
  showMemory?: boolean;
  getRuntimeHealth?: () => ShellPanelLine | undefined;
  cancellable?: boolean;
  fallbackAvailable?: boolean;
  autoskipPaused?: boolean;
  fallbackProviderName?: string;
  latestIssue?: string | null;
  stopHint?: string;
  controlHint?: string;
  onCommandAction?: (action: ShellAction) => void;
  commands?: readonly ResolvedAppCommand[];
  footerMode?: ShellFooterMode;
};

export type BrowseShellOption<T> = {
  value: T;
  label: string;
  detail?: string;
  previewTitle?: string;
  previewMeta?: readonly string[];
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
  tone?: ShellStatusTone;
  badge?: string;
};

export type BrowseShellResult<T> =
  | { type: "selected"; value: T }
  | { type: "action"; action: ShellAction }
  | { type: "cancelled" };

export type PlaybackShellResult = ShellAction;

export function toShellAction(commandId: AppCommandId): ShellAction {
  switch (commandId) {
    case "search":
    case "setup":
    case "trending":
    case "recommendation":
    case "settings":
    case "presence":
    case "toggle-mode":
    case "quit":
    case "history":
    case "details":
    case "diagnostics":
    case "help":
    case "about":
    case "image-pane":
    case "toggle-autoplay":
    case "provider":
    case "replay":
    case "recover":
    case "fallback":
    case "streams":
    case "source":
    case "quality":
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
      return commandId;
  }
}
