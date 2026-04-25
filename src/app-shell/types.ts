import type { ResolvedAppCommand, AppCommandId } from "./commands";

export type ShellAction =
  | "search"
  | "settings"
  | "toggle-mode"
  | "quit"
  | "history"
  | "diagnostics"
  | "help"
  | "about"
  | "image-pane"
  | "replay"
  | "pick-episode"
  | "next"
  | "previous"
  | "next-season"
  | "provider";

export type ShellMode = "series" | "anime";

export type ShellStatusTone = "neutral" | "success" | "warning" | "error";

export type ShellStatus = {
  label: string;
  tone?: ShellStatusTone;
};

export type FooterAction = {
  key: string;
  label: string;
  action: ShellAction;
  disabled?: boolean;
  reason?: string;
};

export type HomeShellState = {
  mode: ShellMode;
  provider: string;
  subtitle: string;
  animeLang: "sub" | "dub";
  status?: ShellStatus;
  commands?: readonly ResolvedAppCommand[];
};

export type PlaybackShellState = {
  mode: ShellMode;
  provider: string;
  title: string;
  type: "movie" | "series";
  season: number;
  episode: number;
  subtitleStatus?: string;
  showMemory: boolean;
  memoryUsage?: string;
  status?: ShellStatus;
  commands?: readonly ResolvedAppCommand[];
};

export type LoadingShellState = {
  title: string;
  subtitle?: string;
  operation: "searching" | "scraping" | "resolving" | "loading";
  progress?: number; // 0-100 or undefined for indeterminate
  details?: string;
  cancellable?: boolean;
};

export type BrowseShellOption<T> = {
  value: T;
  label: string;
  detail?: string;
  previewTitle?: string;
  previewMeta?: readonly string[];
  previewBody?: string;
  previewNote?: string;
};

export type BrowseShellSearchResponse<T> = {
  options: readonly BrowseShellOption<T>[];
  subtitle: string;
  emptyMessage?: string;
};

export type BrowseShellResult<T> =
  | { type: "selected"; value: T }
  | { type: "action"; action: ShellAction }
  | { type: "cancelled" };

export function toShellAction(commandId: AppCommandId): ShellAction {
  switch (commandId) {
    case "search":
    case "settings":
    case "toggle-mode":
    case "quit":
    case "history":
    case "diagnostics":
    case "help":
    case "about":
    case "image-pane":
    case "provider":
    case "replay":
    case "pick-episode":
    case "next":
    case "previous":
    case "next-season":
      return commandId;
  }
}
