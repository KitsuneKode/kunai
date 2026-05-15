import type { SessionState } from "./SessionState";

export type AppCommandId =
  | "setup"
  | "search"
  | "filters"
  | "trending"
  | "recommendation"
  | "calendar"
  | "random"
  | "surprise"
  | "settings"
  | "presence"
  | "toggle-mode"
  | "quit"
  | "provider"
  | "history"
  | "details"
  | "diagnostics"
  | "help"
  | "about"
  | "update"
  | "image-pane"
  | "toggle-autoplay"
  | "replay"
  | "recover"
  | "fallback"
  | "streams"
  | "source"
  | "quality"
  | "pick-episode"
  | "next"
  | "previous"
  | "next-season"
  | "clear-cache"
  | "clear-history"
  | "export-diagnostics"
  | "report-issue"
  | "download"
  | "downloads"
  | "library";

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

export const COMMAND_CONTEXTS = {
  rootOverlay: [
    "setup",
    "settings",
    "presence",
    "provider",
    "history",
    "downloads",
    "library",
    "help",
    "about",
    "update",
    "diagnostics",
    "export-diagnostics",
    "report-issue",
  ],
  activePlayback: [
    "setup",
    "toggle-autoplay",
    "settings",
    "presence",
    "recover",
    "fallback",
    "pick-episode",
    "streams",
    "source",
    "quality",
    "download",
    "downloads",
    "library",
    "next",
    "previous",
    "history",
    "diagnostics",
    "report-issue",
    "help",
    "about",
    "update",
    "quit",
  ],
  postPlayback: [
    "setup",
    "search",
    "recommendation",
    "calendar",
    "random",
    "surprise",
    "settings",
    "presence",
    "toggle-mode",
    "provider",
    "history",
    "toggle-autoplay",
    "replay",
    "fallback",
    "streams",
    "source",
    "quality",
    "download",
    "downloads",
    "library",
    "pick-episode",
    "next",
    "previous",
    "next-season",
    "diagnostics",
    "export-diagnostics",
    "report-issue",
    "help",
    "about",
    "update",
    "quit",
  ],
} as const satisfies Record<string, readonly AppCommandId[]>;

export type CommandContextId = keyof typeof COMMAND_CONTEXTS;

export const COMMANDS: readonly AppCommand[] = [
  {
    id: "setup",
    label: "Setup Wizard",
    aliases: ["setup", "onboarding", "wizard"],
    description: "Run the onboarding wizard to configure downloads and offline defaults",
  },
  {
    id: "download",
    label: "Download",
    aliases: ["download", "save"],
    description: "Queue the selected title or current episode for offline download",
  },
  {
    id: "downloads",
    label: "Download Jobs",
    aliases: ["downloads", "download-jobs", "jobs"],
    description: "Inspect and control queued/running/failed download jobs",
  },
  {
    id: "library",
    label: "Offline Library",
    aliases: ["library", "offline", "offline-library", "my-downloads"],
    description: "Browse completed downloads and play local files",
  },
  {
    id: "search",
    label: "Search",
    aliases: ["search", "find"],
    description: "Start a new search",
  },
  {
    id: "filters",
    label: "Filters",
    aliases: ["filters", "advanced-search", "filter"],
    description: "Show supported search filter syntax",
  },
  {
    id: "trending",
    label: "Trending",
    aliases: ["trending", "popular"],
    description: "Load the cached trending discovery list",
  },
  {
    id: "recommendation",
    label: "Discover",
    aliases: ["recommendation", "recommendations", "recs", "suggest", "discover"],
    description: "Open /discover with personalized recommendations and trending content",
  },
  {
    id: "calendar",
    label: "Release Calendar",
    aliases: ["calendar", "schedule", "airing", "today", "releases"],
    description: "Open releases airing today without resolving provider streams",
  },
  {
    id: "random",
    label: "Random Picks",
    aliases: ["random", "roulette", "spin", "pick-for-me"],
    description: "Spin a small explained tray of recommendations without autoplaying",
  },
  {
    id: "surprise",
    label: "Surprise Me",
    aliases: ["surprise", "surprise-me", "recommend-me"],
    description: "Spin the same non-autoplay surprise tray with a friendlier command",
  },
  {
    id: "settings",
    label: "Settings",
    aliases: ["settings", "config", "prefs"],
    description: "Open settings",
  },
  {
    id: "presence",
    label: "Discord Presence",
    aliases: ["presence", "discord", "rpc", "rich-presence"],
    description: "Open settings for Discord Rich Presence setup and status",
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
    id: "update",
    label: "Update",
    aliases: ["update", "upgrade", "check-update", "version-check"],
    description: "Check for a new Kunai version and show safe update guidance",
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
    id: "recover",
    label: "Recover Playback",
    aliases: ["recover", "fix", "repair", "retry-playback"],
    description: "Run the safest recovery action for the current playback problem",
  },
  {
    id: "fallback",
    label: "Fallback Provider",
    aliases: ["fallback", "try-next-provider", "next-provider", "f"],
    description: "Stop waiting on the current provider and try the next compatible provider",
  },
  {
    id: "streams",
    label: "Streams",
    aliases: ["streams", "stream", "variants"],
    description: "Choose source, quality, audio, or subtitle stream details",
  },
  {
    id: "source",
    label: "Source Picker",
    aliases: ["source", "sources", "mirror"],
    description: "Open available stream sources",
  },
  {
    id: "quality",
    label: "Quality Picker",
    aliases: ["quality", "qualities", "variant"],
    description: "Open available quality variants",
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
  {
    id: "export-diagnostics",
    label: "Export Diagnostics",
    aliases: ["export-diagnostics", "export-logs", "diag-export"],
    description: "Write recent diagnostics events to a redacted JSON file in the working directory",
  },
  {
    id: "report-issue",
    label: "Report Issue",
    aliases: ["report-issue", "issue", "bug-report"],
    description: "Open the GitHub issue page with diagnostics guidance",
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
  return allowed.flatMap((id) => {
    const command = COMMANDS.find((candidate) => candidate.id === id);
    return command
      ? [
          {
            ...resolveCommandPresentation(command, state),
            ...resolveCommandState(command.id, state),
          },
        ]
      : [];
  });
}

export function resolveCommandContext(
  state: SessionState,
  context: CommandContextId,
): readonly ResolvedAppCommand[] {
  return resolveCommands(state, COMMAND_CONTEXTS[context]);
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
  const hasStreamCandidates = Boolean(state.stream?.providerResolveResult?.streams.length);
  const hasResolvedStream = Boolean(state.stream?.url);
  const playbackCanRecover =
    state.playbackStatus === "loading" ||
    state.playbackStatus === "ready" ||
    state.playbackStatus === "buffering" ||
    state.playbackStatus === "seeking" ||
    state.playbackStatus === "stalled" ||
    state.playbackStatus === "playing" ||
    state.playbackStatus === "error";

  switch (id) {
    case "setup":
    case "search":
    case "trending":
    case "recommendation":
    case "calendar":
    case "random":
    case "surprise":
    case "settings":
    case "presence":
    case "history":
    case "details":
    case "diagnostics":
    case "help":
    case "about":
    case "update":
    case "clear-cache":
    case "clear-history":
    case "export-diagnostics":
    case "report-issue":
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

    case "recover":
      if (!playbackCanRecover) {
        return {
          enabled: false,
          reason: "Start playback before recovery controls are available.",
        };
      }
      return { enabled: true };

    case "fallback":
      if (!hasEpisode) {
        return {
          enabled: false,
          reason: "Start playback before provider fallback is available.",
        };
      }
      return { enabled: true };

    case "streams":
      if (!hasEpisode) {
        return {
          enabled: false,
          reason: "Start playback before stream selection is available.",
        };
      }
      return hasStreamCandidates
        ? { enabled: true }
        : {
            enabled: false,
            reason: "No stream choices were exposed for this playback.",
          };

    case "source":
      if (!hasEpisode) {
        return {
          enabled: false,
          reason: "Start playback before source selection is available.",
        };
      }
      if (resolving) {
        return {
          enabled: false,
          reason: "Wait for stream resolution to finish first.",
        };
      }
      return hasStreamCandidates
        ? { enabled: true }
        : {
            enabled: false,
            reason: "No provider source candidates were exposed for this stream.",
          };

    case "quality":
      if (!hasEpisode) {
        return {
          enabled: false,
          reason: "Start playback before quality selection is available.",
        };
      }
      if (resolving) {
        return {
          enabled: false,
          reason: "Wait for stream resolution to finish first.",
        };
      }
      return hasStreamCandidates
        ? { enabled: true }
        : {
            enabled: false,
            reason: "No quality candidates were exposed for this stream.",
          };

    case "download":
      if (!hasEpisode && state.view !== "results") {
        return {
          enabled: false,
          reason: "Select a search result or start playback before downloads are available.",
        };
      }
      if (!hasEpisode && state.searchResults.length > 0) {
        return { enabled: true };
      }
      return hasResolvedStream
        ? { enabled: true }
        : {
            enabled: false,
            reason: "No resolved stream is available to download yet.",
          };

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

    case "downloads":
      return { enabled: true };

    case "library":
      return { enabled: true };

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
