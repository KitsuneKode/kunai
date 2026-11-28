import { resolveBrowseDestinationLabel } from "./browse-destination";
import type { ResolvedAppCommand } from "./commands";
import { buildFooterActionsFromBindings } from "./keybindings";
import { getCommandLabel } from "./shell-frame";
import { selectFooterActions } from "./shell-primitives";
import type { FooterAction, ShellFooterMode } from "./types";

export type BrowseFooterModelInput = {
  readonly detailsOpen: boolean;
  readonly detailsCapabilities: {
    readonly play: boolean;
    readonly queue: boolean;
    readonly watchlist: boolean;
    readonly download: boolean;
  };
  readonly calendarError: boolean;
  readonly listFocused: boolean;
  readonly idleFocused: boolean;
  readonly idleRowCanOpenMenu: boolean;
  readonly canFocusIdleRows: boolean;
  readonly optionCount: number;
  readonly queryDirty: boolean;
  readonly searchState: "idle" | "loading" | "ready" | "error";
  readonly commands: readonly ResolvedAppCommand[];
  readonly hasDiscovery: boolean;
  readonly hasQueueHandler: boolean;
  readonly hasWatchlistHandler: boolean;
  readonly hasFavoriteHandler: boolean;
  readonly hasFollowHandler: boolean;
  readonly isCalendarView: boolean;
  readonly query: string;
  readonly resultSubtitle: string;
  readonly emptyMessage: string;
  readonly mouseHint: boolean;
  readonly mode: ShellFooterMode;
  readonly terminalWidth: number;
  readonly maxVisible: number;
};

function detailsFooterActions(
  capabilities: BrowseFooterModelInput["detailsCapabilities"],
): readonly FooterAction[] {
  return [
    ...(capabilities.play
      ? [{ key: "enter", label: "play", action: "search", primary: true } as const]
      : []),
    { key: "esc", label: "close", action: "quit" },
    ...(capabilities.queue ? [{ key: "q", label: "queue", action: "up-next" } as const] : []),
    ...(capabilities.watchlist
      ? [{ key: "w", label: "watchlist", action: "bookmark" } as const]
      : []),
    ...(capabilities.download
      ? [{ key: "d", label: "download", action: "download" } as const]
      : []),
  ];
}

function browseBindingIds(input: BrowseFooterModelInput): readonly string[] {
  return [
    ...(input.listFocused && input.searchState === "ready" ? ["browse-details"] : []),
    // Ctrl+O works from the search box without stealing typing — advertise it
    // when results exist and query still owns focus.
    ...(input.optionCount > 0 &&
    !input.queryDirty &&
    input.searchState === "ready" &&
    !input.listFocused &&
    !input.idleFocused
      ? ["browse-details-ctrl"]
      : []),
    ...(input.listFocused && input.searchState === "ready" ? ["browse-title-control-menu"] : []),
    ...(input.idleFocused && input.idleRowCanOpenMenu ? ["browse-title-control-menu"] : []),
    ...(input.listFocused &&
    input.optionCount > 0 &&
    !input.queryDirty &&
    input.searchState === "ready"
      ? ["browse-filter"]
      : []),
    "browse-mode",
    ...(input.hasDiscovery ? ["browse-trending"] : []),
    ...(input.listFocused && input.optionCount > 0 && !input.queryDirty
      ? [
          "browse-download",
          ...(input.hasQueueHandler ? ["browse-queue"] : []),
          ...(input.hasWatchlistHandler ? ["browse-watchlist"] : []),
          ...(input.hasFavoriteHandler ? ["browse-favorite"] : []),
          ...(input.hasFollowHandler ? ["browse-follow"] : []),
        ]
      : []),
  ];
}

function browseActions(input: BrowseFooterModelInput): readonly FooterAction[] {
  return [
    {
      key: "enter",
      label: input.idleFocused ? "act" : input.listFocused ? "play" : "search",
      action: "search",
      primary: true,
    },
    {
      key: "↑↓",
      label:
        input.listFocused || input.idleFocused
          ? "navigate · ↑↓ ends → search"
          : input.canFocusIdleRows || input.optionCount > 0
            ? "navigate · ↓ leave search"
            : "navigate",
      action: "search",
    },
    ...buildFooterActionsFromBindings("browse", {
      ids: browseBindingIds(input),
      tail: false,
      actions: {
        "browse-details": "details",
        "browse-details-ctrl": "details",
        "browse-title-control-menu": "menu",
        "browse-filter": "narrow-results",
        "browse-mode": "toggle-mode",
        "browse-trending": "trending",
        "browse-download": "download",
        "browse-queue": "up-next",
        "browse-watchlist": "bookmark",
        "browse-follow": "follow",
      },
      overrides: {
        "browse-mode": {
          label: getCommandLabel(input.commands, "toggle-mode", "switch mode"),
        },
      },
    }),
    { key: "/", label: "commands", action: "command-mode" },
    {
      key: "esc",
      label: input.listFocused || input.idleFocused ? "→ search" : "clear/back",
      action: "quit",
    },
  ];
}

export type BrowseFooterModel = {
  readonly taskLabel: string;
  readonly actions: readonly FooterAction[];
};

export function buildBrowseFooterModel(input: BrowseFooterModelInput): BrowseFooterModel {
  const select = (actions: readonly FooterAction[]) =>
    selectFooterActions(actions, input.mode, input.terminalWidth, input.maxVisible);

  if (input.detailsOpen) {
    return {
      taskLabel: "Details",
      actions: select(detailsFooterActions(input.detailsCapabilities)),
    };
  }
  if (input.calendarError) {
    return {
      taskLabel: "Calendar · issue",
      actions: select([
        { key: "r", label: "retry", primary: true },
        { key: "esc", label: "back", action: "quit" },
        { key: "/", label: "commands", action: "command-mode" },
      ]),
    };
  }

  const taskLabel = resolveBrowseDestinationLabel({
    isCalendar: input.isCalendarView,
    query: input.query,
    resultSubtitle: input.resultSubtitle,
    emptyMessage: input.emptyMessage,
    hasResults: input.optionCount > 0,
    searchState: input.searchState,
  });
  return {
    taskLabel: input.mouseHint ? "Click to select · click selection to open" : taskLabel,
    actions: select(browseActions(input)),
  };
}
