import type { AppCommandId } from "./commands";

export type ShellAction =
  | "search"
  | "settings"
  | "toggle-mode"
  | "quit"
  | "replay"
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
};

export type PlaybackShellState = {
  mode: ShellMode;
  provider: string;
  title: string;
  type: "movie" | "series";
  season: number;
  episode: number;
  showMemory: boolean;
  memoryUsage?: string;
  status?: ShellStatus;
};

export type LoadingShellState = {
  title: string;
  subtitle?: string;
  operation: "searching" | "scraping" | "resolving" | "loading";
  progress?: number; // 0-100 or undefined for indeterminate
  details?: string;
  cancellable?: boolean;
};

export function toShellAction(commandId: AppCommandId): ShellAction {
  switch (commandId) {
    case "search":
    case "settings":
    case "toggle-mode":
    case "quit":
    case "provider":
    case "replay":
    case "next":
    case "previous":
    case "next-season":
      return commandId;
  }
}
