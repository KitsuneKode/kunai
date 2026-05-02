import type { SessionState } from "./SessionState";

export type AppCommandId =
  | "search"
  | "settings"
  | "toggle-mode"
  | "quit"
  | "provider"
  | "history"
  | "details"
  | "diagnostics"
  | "help"
  | "about"
  | "image-pane"
  | "toggle-autoplay"
  | "replay"
  | "pick-episode"
  | "next"
  | "previous"
  | "next-season"
  | "clear-cache"
  | "clear-history";

export type AppCommand = {
  readonly id: AppCommandId;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly description: string;
};

export type ResolvedAppCommand = AppCommand & {
  readonly enabled: boolean;
  readonly reason?: string;
};

export const COMMANDS: readonly AppCommand[] = [
  {
    id: "search",
    label: "Search",
    aliases: ["search", "find"],
    description: "Start a new search",
  },
  {
    id: "settings",
    label: "Settings",
    aliases: ["settings", "config", "prefs"],
    description: "Open settings",
  },
  {
    id: "toggle-mode",
    label: "Toggle Mode",
    aliases: ["mode", "toggle-mode", "anime"],
    description: "Switch between anime and series mode",
  },
  {
    id: "quit",
    label: "Quit",
    aliases: ["quit", "exit", "q"],
    description: "Exit Kunai",
  },
  {
    id: "provider",
    label: "Provider Picker",
    aliases: ["provider", "switch-provider"],
    description: "Open the provider picker",
  },
  {
    id: "history",
    label: "History",
    aliases: ["history", "resume", "recent"],
    description: "Open watch history",
  },
  {
    id: "details",
    label: "Details",
    aliases: ["details", "detail", "overview", "info"],
    description: "Open the expanded title overview",
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    aliases: ["diagnostics", "logs", "debug"],
    description: "Open diagnostics",
  },
  {
    id: "help",
    label: "Help",
    aliases: ["help", "shortcuts", "?"],
    description: "Show shortcuts and command help",
  },
  {
    id: "about",
    label: "About",
    aliases: ["about", "version"],
    description: "Show version and capability information",
  },
  {
    id: "image-pane",
    label: "Image Pane",
    aliases: ["image", "preview", "poster"],
    description: "Toggle the image and details companion pane",
  },
  {
    id: "toggle-autoplay",
    label: "Pause Autoplay",
    aliases: ["autoplay", "pause-autoplay", "resume-autoplay"],
    description: "Temporarily pause or resume autoplay for this playback chain",
  },
  {
    id: "replay",
    label: "Replay",
    aliases: ["replay", "restart"],
    description: "Replay the current item",
  },
  {
    id: "pick-episode",
    label: "Pick Episode",
    aliases: ["episode", "pick-episode", "episodes"],
    description: "Open the episode picker",
  },
  {
    id: "next",
    label: "Next Episode",
    aliases: ["next", "n"],
    description: "Advance to the next episode",
  },
  {
    id: "previous",
    label: "Previous Episode",
    aliases: ["previous", "prev", "p"],
    description: "Go to the previous episode",
  },
  {
    id: "next-season",
    label: "Next Season",
    aliases: ["season", "next-season"],
    description: "Jump to the next season",
  },
  {
    id: "clear-cache",
    label: "Clear Cache",
    aliases: ["clear-cache", "purge-cache", "flush-cache"],
    description: "Remove all cached stream URLs",
  },
  {
    id: "clear-history",
    label: "Clear History",
    aliases: ["clear-history", "reset-history", "wipe-history"],
    description: "Remove all watch history and progress",
  },
] as const;

export function parseCommand(input: string): AppCommand | null {
  const normalized = input.trim().replace(/^\//, "").toLowerCase();
  if (!normalized) return null;
  return COMMANDS.find((command) => command.aliases.includes(normalized)) ?? null;
}

export function suggestCommands(
  input: string,
  allowed: readonly AppCommandId[],
): readonly AppCommand[] {
  const normalized = input.trim().replace(/^\//, "").toLowerCase();
  const pool = COMMANDS.filter((command) => allowed.includes(command.id));
  if (!normalized) return pool;
  return pool.filter(
    (command) =>
      command.aliases.some((alias) => alias.includes(normalized)) ||
      command.label.toLowerCase().includes(normalized),
  );
}

export function resolveCommands(
  state: SessionState,
  allowed: readonly AppCommandId[] = COMMANDS.map((command) => command.id),
): readonly ResolvedAppCommand[] {
  return COMMANDS.filter((command) => allowed.includes(command.id)).map((command) => ({
    ...resolveCommandPresentation(command, state),
    ...resolveCommandState(command.id, state),
  }));
}

function resolveCommandPresentation(command: AppCommand, state: SessionState): AppCommand {
  if (command.id === "toggle-mode") {
    const targetMode = state.mode === "anime" ? "series" : "anime";
    return {
      ...command,
      label: targetMode === "anime" ? "Anime Mode" : "Series Mode",
      description: targetMode === "anime" ? "Switch into anime mode" : "Switch into series mode",
    };
  }

  if (command.id === "next" && state.episodeNavigation.nextLabel) {
    return {
      ...command,
      label: `Next ${state.episodeNavigation.nextLabel}`,
      description: "Advance to the next available episode",
    };
  }

  if (command.id === "previous" && state.episodeNavigation.previousLabel) {
    return {
      ...command,
      label: `Previous ${state.episodeNavigation.previousLabel}`,
      description: "Go to the previous available episode",
    };
  }

  if (command.id === "next-season" && state.episodeNavigation.nextSeasonLabel) {
    return {
      ...command,
      label: `Next Season ${state.episodeNavigation.nextSeasonLabel}`,
      description: "Jump to the first available episode of the next season",
    };
  }

  if (command.id === "toggle-autoplay") {
    return {
      ...command,
      label: state.autoplaySessionPaused ? "Resume Autoplay" : "Pause Autoplay",
      description: state.autoplaySessionPaused
        ? "Resume autoplay for this playback chain"
        : "Pause autoplay for this playback chain",
    };
  }

  return command;
}

function resolveCommandState(
  id: AppCommandId,
  state: SessionState,
): { enabled: boolean; reason?: string } {
  const hasEpisode = state.currentEpisode !== null;
  const inSeriesContext = state.currentTitle?.type === "series" && hasEpisode;
  const resolving =
    state.playbackStatus === "loading" ||
    state.playbackStatus === "ready" ||
    state.playbackStatus === "buffering" ||
    state.playbackStatus === "seeking" ||
    state.playbackStatus === "stalled";
  const hasOverlay = state.activeModals.length > 0;

  switch (id) {
    case "search":
    case "settings":
    case "history":
    case "details":
    case "diagnostics":
    case "help":
    case "about":
    case "clear-cache":
    case "clear-history":
      return { enabled: true };

    case "toggle-mode":
      return resolving
        ? {
            enabled: false,
            reason: "Wait for stream resolution to finish first.",
          }
        : { enabled: true };

    case "quit":
      if (hasOverlay) {
        return {
          enabled: false,
          reason: "Close the current overlay before quitting.",
        };
      }
      return { enabled: true };

    case "provider":
      if (resolving) {
        return {
          enabled: false,
          reason: "Wait for stream resolution to finish first.",
        };
      }
      return { enabled: true };

    case "image-pane":
      if (!state.layout.details.imageSupported) {
        return {
          enabled: false,
          reason: "Image preview is unavailable in this terminal.",
        };
      }
      if (state.layout.tooSmall) {
        return {
          enabled: false,
          reason: "Terminal too small for image preview.",
        };
      }
      return { enabled: true };

    case "toggle-autoplay":
      if (state.currentTitle?.type !== "series" || !hasEpisode) {
        return {
          enabled: false,
          reason: "Autoplay controls are only available for episodic playback.",
        };
      }
      if (resolving) {
        return {
          enabled: false,
          reason: "Wait for stream resolution to finish first.",
        };
      }
      return { enabled: true };

    case "replay":
      if (!hasEpisode) {
        return {
          enabled: false,
          reason: "Start playback before replay is available.",
        };
      }
      if (resolving) {
        return {
          enabled: false,
          reason: "Wait for stream resolution to finish first.",
        };
      }
      return { enabled: true };

    case "pick-episode":
      if (!inSeriesContext) {
        return {
          enabled: false,
          reason: "Episode picker is only available for episodic playback.",
        };
      }
      if (resolving) {
        return {
          enabled: false,
          reason: "Wait for stream resolution to finish first.",
        };
      }
      return { enabled: true };

    case "next":
      if (!inSeriesContext) {
        return {
          enabled: false,
          reason: "Next episode is only available for episodic playback.",
        };
      }
      return state.episodeNavigation.hasNext
        ? { enabled: true }
        : {
            enabled: false,
            reason:
              state.episodeNavigation.nextUnavailableReason ??
              "No later episode metadata is available yet.",
          };

    case "previous":
      if (!inSeriesContext) {
        return {
          enabled: false,
          reason: "Previous episode is only available for episodic playback.",
        };
      }
      return state.episodeNavigation.hasPrevious
        ? { enabled: true }
        : {
            enabled: false,
            reason:
              state.episodeNavigation.previousUnavailableReason ??
              "Already at the first known episode.",
          };

    case "next-season":
      if (!inSeriesContext) {
        return {
          enabled: false,
          reason: "Season jump is only available for episodic playback.",
        };
      }
      return state.episodeNavigation.hasNextSeason
        ? { enabled: true }
        : {
            enabled: false,
            reason:
              state.episodeNavigation.nextSeasonUnavailableReason ??
              "No next-season metadata is available yet.",
          };
  }
}
