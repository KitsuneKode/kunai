import { isLocalPlaybackStream } from "@/app/playback/playback-source-ui";

import { rankFuzzyMatches } from "./fuzzy-match";
import type { SessionState } from "./SessionState";

export type AppCommandId =
  | "setup"
  | "search"
  | "filters"
  | "trending"
  | "recommendation"
  | "calendar"
  | "anime-calendar"
  | "series-calendar"
  | "random"
  | "surprise"
  | "settings"
  | "presence"
  | "notifications"
  | "toggle-mode"
  | "quit"
  | "provider"
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
  | "bookmark"
  | "follow"
  | "unfollow"
  | "mute"
  | "mark-watched"
  | "mark-unwatched"
  | "mark-season-watched"
  | "mark-up-to-episode"
  | "pick-episode"
  | "next"
  | "previous"
  | "next-season"
  | "clear-cache"
  | "reset-provider-health"
  | "clear-history"
  | "export-diagnostics"
  | "report-issue"
  | "download"
  | "downloads"
  | "library"
  | "watchlist"
  | "favorites"
  | "playlists"
  | "up-next"
  | "playlist-add"
  | "queue-season"
  | "stats"
  | "sync"
  | "sync-connect-anilist"
  | "sync-connect-tmdb"
  | "sync-disconnect"
  | "continue"
  | "play-local"
  | "watch-online"
  | "menu";

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
    "continue",
    "watch",
    "watchlist",
    "playlists",
    "up-next",
    "library",
    "downloads",
    "notifications",
    "history",
    "setup",
    "settings",
    "provider",
    "presence",
    "diagnostics",
    "export-diagnostics",
    "report-issue",
    "docs",
    "help",
    "menu",
    "about",
    "update",
  ],
  activePlayback: [
    "recover",
    "recompute",
    "fallback",
    "play-local",
    "watch-online",
    "source",
    "quality",
    "audio",
    "subtitle",
    "memory",
    "mark-anime",
    "mark-series",
    "share",
    "bookmark",
    "follow",
    "unfollow",
    "mute",
    "mark-watched",
    "mark-unwatched",
    "mark-season-watched",
    "mark-up-to-episode",
    "pick-episode",
    "download",
    "next",
    "previous",
    "toggle-autoplay",
    "toggle-autoskip",
    "stop-after-current",
    "downloads",
    "library",
    "notifications",
    "history",
    "diagnostics",
    "export-diagnostics",
    "report-issue",
    "clear-cache",
    "reset-provider-health",
    "docs",
    "settings",
    "presence",
    "setup",
    "help",
    "menu",
    "about",
    "update",
    "quit",
  ],
  postPlayback: [
    "next",
    "replay",
    "mark-anime",
    "mark-series",
    "share",
    "bookmark",
    "follow",
    "unfollow",
    "mute",
    "mark-watched",
    "mark-unwatched",
    "mark-season-watched",
    "mark-up-to-episode",
    "pick-episode",
    "download",
    "library",
    "downloads",
    "notifications",
    "watchlist",
    "playlists",
    "up-next",
    "recommendation",
    "calendar",
    "anime-calendar",
    "series-calendar",
    "search",
    "history",
    "recover",
    "recompute",
    "fallback",
    "play-local",
    "watch-online",
    "source",
    "quality",
    "audio",
    "subtitle",
    "toggle-autoplay",
    "toggle-autoskip",
    "stop-after-current",
    "previous",
    "next-season",
    "provider",
    "toggle-mode",
    "diagnostics",
    "export-diagnostics",
    "report-issue",
    "clear-cache",
    "reset-provider-health",
    "docs",
    "settings",
    "presence",
    "setup",
    "help",
    "menu",
    "about",
    "update",
    "quit",
  ],
} as const satisfies Record<string, readonly AppCommandId[]>;

export type CommandContextId = keyof typeof COMMAND_CONTEXTS;

export type AppCommandGroup = "Core" | "Playback" | "Attention" | "Advanced" | "Experimental";

export const COMMANDS: readonly AppCommand[] = [
  {
    id: "setup",
    label: "Setup Wizard",
    aliases: ["setup", "onboarding", "wizard"],
    description: "Configure downloads and offline defaults",
  },
  {
    id: "download",
    label: "Download",
    aliases: ["download", "save"],
    description: "Queue the selected title for offline download",
  },
  {
    id: "downloads",
    label: "Download Queue",
    aliases: ["downloads", "download-jobs", "jobs"],
    description: "Inspect active, queued, and failed download jobs",
  },
  {
    id: "library",
    label: "Library",
    aliases: ["library", "offline", "offline-library", "my-downloads"],
    description: "Browse offline library and manage downloads",
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
    label: "Recommendations",
    aliases: ["recommendation", "recommendations", "recs", "suggest", "discover"],
    description: "Personalized recommendations and discovery",
  },
  {
    id: "calendar",
    label: "Release Calendar",
    aliases: ["calendar", "schedule", "airing", "today", "releases"],
    description: "Anime and series release schedule",
  },
  {
    id: "anime-calendar",
    label: "Anime Calendar",
    aliases: ["anime-calendar", "anime-schedule", "anime-airing"],
    description: "Release schedule filtered to anime",
  },
  {
    id: "series-calendar",
    label: "Series Calendar",
    aliases: ["series-calendar", "tv-calendar", "series-schedule"],
    description: "Release schedule filtered to series",
  },
  {
    id: "random",
    label: "Random Picks",
    aliases: ["random", "roulette", "spin", "pick-for-me"],
    description: "Random recommendation tray without autoplay",
  },
  {
    id: "surprise",
    label: "Surprise Me",
    aliases: ["surprise", "surprise-me", "recommend-me"],
    description: "Surprise pick without autoplay",
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
    id: "notifications",
    label: "Notifications",
    aliases: ["notifications", "inbox", "alerts"],
    description: "Review actionable app notices and recoverable queues",
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
    description: "Open the tracks panel at the provider section",
  },
  {
    id: "continue",
    label: "Continue Watching",
    aliases: ["continue", "c"],
    description: "Open unfinished and recent watch progress",
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
    id: "docs",
    label: "Docs",
    aliases: ["docs", "documentation", "guide", "manual"],
    description: "Open Kunai documentation",
  },
  {
    id: "help",
    label: "Help",
    aliases: ["help", "shortcuts", "?"],
    description: "Show shortcuts and command help",
  },
  {
    id: "menu",
    label: "Title Control Menu",
    aliases: ["menu", "title-control", "title-menu"],
    description: "Open the unified title control menu",
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
    id: "toggle-autoskip",
    label: "Pause Autoskip",
    aliases: ["autoskip", "skip", "pause-autoskip", "resume-autoskip"],
    description: "Temporarily pause or resume auto-skip for this session",
  },
  {
    id: "stop-after-current",
    label: "Stop After Current",
    aliases: ["stop-after", "stop-after-current", "one-more", "finish-episode"],
    description: "Stop after current episode instead of continuing",
  },
  {
    id: "replay",
    label: "Replay",
    aliases: ["replay", "restart"],
    description: "Restart the current item from the beginning without refreshing the source",
  },
  {
    id: "recover",
    label: "Recover Playback",
    aliases: ["recover", "fix", "repair", "retry-playback"],
    description: "Refresh the current stream and resume this episode after a playback issue",
  },
  {
    id: "recompute",
    label: "Recompute Sources",
    aliases: [
      "recompute",
      "refresh-sources",
      "force-refresh",
      "bypass-cache",
      "ignore-cache",
      "all-sources",
      "all-servers",
      "probe-sources",
    ],
    description:
      "Re-resolve on the current provider only: bypass stream cache and provider memory, then probe all VidKing sources",
  },
  {
    id: "fallback",
    label: "Fallback Provider",
    aliases: ["fallback", "try-next-provider", "next-provider", "f"],
    description: "Stop waiting on the current provider and try the next compatible provider",
  },
  {
    id: "play-local",
    label: "Play Downloaded Copy",
    aliases: ["play-local", "local", "offline-play", "play-offline"],
    description: "Switch the current episode to the verified offline download",
  },
  {
    id: "watch-online",
    label: "Watch Online",
    aliases: ["watch-online", "online", "stream-online"],
    description: "Switch the current episode back to online provider streaming",
  },
  {
    id: "source",
    label: "Source / Servers",
    aliases: ["source", "sources", "mirror", "server", "servers", "tracks"],
    description: "Open the tracks panel at the source / servers section",
  },
  {
    id: "quality",
    label: "Quality",
    aliases: ["quality", "qualities", "variant"],
    description: "Open the tracks panel at the quality section",
  },
  {
    id: "audio",
    label: "Audio",
    aliases: ["audio", "dub", "language"],
    description: "Open the tracks panel at the audio section",
  },
  {
    id: "subtitle",
    label: "Subtitles",
    aliases: ["subtitle", "subtitles", "subs", "captions", "cc"],
    description: "Open the tracks panel at the subtitles section",
  },
  {
    id: "memory",
    label: "Memory",
    aliases: ["memory", "mem"],
    description: "Temporarily show runtime memory usage",
  },
  {
    id: "mark-anime",
    label: "Mark as Anime",
    aliases: ["mark-anime", "set-anime", "is-anime"],
    description: "Reclassify the current title as anime in your history (fixes a wrong label)",
  },
  {
    id: "mark-series",
    label: "Mark as Series",
    aliases: ["mark-series", "set-series", "not-anime"],
    description: "Reclassify the current title as series in your history (fixes a wrong label)",
  },
  {
    id: "share",
    label: "Share This",
    aliases: ["share", "share-link", "share-code"],
    description: "Copy a catalog-anchored kunai:// share link for the current title",
  },
  {
    id: "bookmark",
    label: "Bookmark Current",
    aliases: ["bookmark", "bookmarks-add", "save-current", "watchlist-add"],
    description: "Save or unsave the current title in your watchlist",
  },
  {
    id: "follow",
    label: "Follow Releases",
    aliases: ["follow", "track", "track-releases"],
    description: "Track future releases and notices for the current title",
  },
  {
    id: "unfollow",
    label: "Unfollow Releases",
    aliases: ["unfollow", "untrack", "stop-following"],
    description: "Stop explicit release tracking without muting the title",
  },
  {
    id: "mute",
    label: "Mute Releases",
    aliases: ["mute", "mute-title", "mute-releases", "hide-releases"],
    description: "Stop release notices for the current title",
  },
  {
    id: "mark-watched",
    label: "Mark Watched",
    aliases: ["mark-watched", "watched", "complete", "finish"],
    description: "Mark the current movie or episode as fully watched",
  },
  {
    id: "mark-unwatched",
    label: "Mark Unwatched",
    aliases: ["mark-unwatched", "unwatched", "unwatch"],
    description: "Clear the watched flag while keeping resume position",
  },
  {
    id: "mark-season-watched",
    label: "Mark Season Watched",
    aliases: ["mark-season-watched", "season-watched", "mark-season"],
    description: "Mark every episode in the current season up to the current episode as watched",
  },
  {
    id: "mark-up-to-episode",
    label: "Mark Up To Episode",
    aliases: ["mark-up-to-episode", "mark-through", "mark-through-episode"],
    description: "Pick an episode and mark the whole season through that episode as watched",
  },
  {
    id: "watch",
    label: "Watch a Shared Code",
    aliases: ["watch", "open-share", "open-link"],
    description: "Open a kunai:// share link from your clipboard",
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
    description: "Clear stream URL cache (and optionally provider failure memory)",
  },
  {
    id: "reset-provider-health",
    label: "Reset Provider Health",
    aliases: ["reset-provider-health", "clear-provider-memory", "forget-provider-failures"],
    description: "Forget provider failures so auto-fallback can retry down providers",
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
    description: "Export recent diagnostics to a redacted JSON file",
  },
  {
    id: "report-issue",
    label: "Report Issue",
    aliases: ["report-issue", "issue", "bug-report"],
    description: "Open the GitHub issue page with diagnostics guidance",
  },
  {
    id: "watchlist",
    label: "Watchlist",
    aliases: ["watchlist", "wl", "watch-list", "watch-later", "bookmarks"],
    description: "View and manage the built-in Watchlist",
  },
  {
    id: "favorites",
    label: "Favorites",
    aliases: ["fav", "favs", "favorites"],
    description: "View your favorite titles",
  },
  {
    id: "playlists",
    label: "Playlists",
    aliases: ["playlists", "playlist", "pl", "lists"],
    description: "View and manage durable playlists",
  },
  {
    id: "up-next",
    label: "Up Next",
    aliases: ["up-next", "upnext", "queue", "queue-playlist"],
    description: "View and manage the current playback order",
  },
  {
    id: "playlist-add",
    label: "Add to Up Next",
    aliases: ["playlist-add", "pl-add", "add-to-up-next", "queue-add", "add-to-queue"],
    description: "Add the current title to Up Next",
  },
  {
    id: "queue-season",
    label: "Queue Rest of Season",
    aliases: ["queue-season", "season-queue", "queue-rest-season"],
    description: "Queue remaining episodes in the current season",
  },
  {
    id: "stats",
    label: "Stats",
    aliases: ["stats", "statistics", "watch-stats"],
    description: "Watch stats, streak, and top shows",
  },
  {
    id: "sync",
    label: "Sync",
    aliases: ["sync", "sync-settings", "integrations"],
    description: "Sync watch progress with AniList or TMDB",
  },
  {
    id: "sync-connect-anilist",
    label: "Connect AniList",
    aliases: ["connect-anilist", "anilist-connect", "anilist"],
    description: "Link your AniList account to sync watch progress",
  },
  {
    id: "sync-connect-tmdb",
    label: "Connect TMDB",
    aliases: ["connect-tmdb", "tmdb-connect", "tmdb"],
    description: "Link your TMDB account to sync watch progress",
  },
  {
    id: "sync-disconnect",
    label: "Disconnect Sync",
    aliases: ["sync-disconnect", "disconnect-sync", "unlink-sync"],
    description: "Remove linked sync accounts",
  },
] as const;

/** Slash commands surfaced in the `?` help overlay (panels & commands section). */
export const HELP_PANEL_COMMAND_IDS = [
  "history",
  "watchlist",
  "playlists",
  "up-next",
  "notifications",
  "diagnostics",
  "downloads",
  "library",
  "settings",
  "setup",
  "presence",
  "follow",
  "unfollow",
  "mute",
  "export-diagnostics",
  "report-issue",
] as const satisfies readonly AppCommandId[];

export type HelpPanelCommandLine = {
  readonly label: string;
  readonly detail: string;
};

export function buildHelpPanelCommandLines(): readonly HelpPanelCommandLine[] {
  return HELP_PANEL_COMMAND_IDS.flatMap((id) => {
    const command = COMMANDS.find((candidate) => candidate.id === id);
    if (!command) return [];
    const slashAlias = command.aliases[0] ?? command.id;
    return [{ label: `/${slashAlias}`, detail: command.description }];
  });
}

export function commandGroupFor(id: AppCommandId): AppCommandGroup {
  switch (id) {
    case "search":
    case "continue":
    case "watchlist":
    case "playlists":
    case "up-next":
    case "download":
    case "downloads":
    case "library":
    case "share":
    case "settings":
    case "help":
      return "Core";
    case "next":
    case "previous":
    case "pick-episode":
    case "replay":
    case "source":
    case "quality":
    case "audio":
    case "subtitle":
    case "recover":
    case "fallback":
    case "toggle-autoplay":
    case "toggle-autoskip":
    case "stop-after-current":
    case "playlist-add":
    case "queue-season":
    case "play-local":
    case "watch-online":
    case "memory":
      return "Playback";
    case "follow":
    case "unfollow":
    case "mute":
    case "notifications":
    case "calendar":
    case "anime-calendar":
    case "series-calendar":
      return "Attention";
    case "sync":
    case "sync-connect-anilist":
    case "sync-connect-tmdb":
    case "sync-disconnect":
    case "favorites":
    case "random":
    case "surprise":
      return "Experimental";
    default:
      return "Advanced";
  }
}

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
  return rankFuzzyMatches(pool, normalized, (command) => [
    ...command.aliases.map((alias, index) => ({
      value: alias,
      weight: index === 0 ? -8 : 6,
    })),
    { value: command.label, weight: 0 },
    { value: command.description, weight: 14 },
  ]);
}

export function resolveCommands(
  state: SessionState,
  allowed: readonly AppCommandId[] = COMMANDS.map((command) => command.id),
  options?: { readonly excludeGroups?: readonly AppCommandGroup[] },
): readonly ResolvedAppCommand[] {
  const excluded = new Set(options?.excludeGroups ?? []);
  const filtered = excluded.size
    ? allowed.filter((id) => !excluded.has(commandGroupFor(id)))
    : allowed;
  return filtered.flatMap((id) => {
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

  if (command.id === "toggle-autoskip") {
    return {
      ...command,
      label: state.autoskipSessionPaused ? "Resume Autoskip" : "Pause Autoskip",
      description: state.autoskipSessionPaused
        ? "Resume auto-skip for this session"
        : "Pause auto-skip for this session",
    };
  }

  if (command.id === "stop-after-current") {
    return {
      ...command,
      label: state.stopAfterCurrent ? "Resume Playback Chain" : "Stop After Current Episode",
      description: state.stopAfterCurrent
        ? "Resume normal playback chain after this episode"
        : "Stop playback after the current episode finishes",
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
  const hasMediaTrackChoices = Boolean(
    hasStreamCandidates ||
    state.stream?.subtitleList?.length ||
    state.stream?.providerResolveResult?.subtitles.length,
  );
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
    case "filters":
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
    case "history":
    case "details":
    case "diagnostics":
    case "docs":
    case "help":
    case "menu":
    case "about":
    case "update":
    case "clear-cache":
    case "reset-provider-health":
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
      return { enabled: true };

    case "toggle-autoskip":
      if (state.currentTitle?.type !== "series" || !hasEpisode) {
        return {
          enabled: false,
          reason: "Auto-skip controls are only available for episodic playback.",
        };
      }
      return { enabled: true };

    case "stop-after-current":
      if (state.currentTitle?.type !== "series" || !hasEpisode) {
        return {
          enabled: false,
          reason: "Stop-after-current is only available for episodic playback.",
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

    case "recompute":
      if (!hasEpisode) {
        return {
          enabled: false,
          reason: "Choose an episode before source recompute is available.",
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

    case "play-local":
      if (!hasEpisode) {
        return {
          enabled: false,
          reason: "Choose an episode before switching to the offline copy.",
        };
      }
      if (!playbackCanRecover) {
        return {
          enabled: false,
          reason: "Start playback before source switching is available.",
        };
      }
      if (state.stream && isLocalPlaybackStream(state.stream)) {
        return {
          enabled: false,
          reason: "Already playing the downloaded copy.",
        };
      }
      return { enabled: true };

    case "watch-online":
      if (!hasEpisode) {
        return {
          enabled: false,
          reason: "Choose an episode before switching back online.",
        };
      }
      if (!playbackCanRecover) {
        return {
          enabled: false,
          reason: "Start playback before source switching is available.",
        };
      }
      if (!state.stream || !isLocalPlaybackStream(state.stream)) {
        return {
          enabled: false,
          reason: "Current playback is already online.",
        };
      }
      return { enabled: true };

    case "audio":
    case "subtitle":
      if (!hasEpisode) {
        return {
          enabled: false,
          reason: "Start playback before track selection is available.",
        };
      }
      return hasMediaTrackChoices
        ? { enabled: true }
        : {
            enabled: false,
            reason: "No stream choices or subtitle choices were exposed for this playback.",
          };

    case "source":
      if (!hasEpisode) {
        return {
          enabled: false,
          reason: "Start playback before source selection is available.",
        };
      }
      if (resolving && !hasStreamCandidates) {
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
      if (resolving && !hasStreamCandidates) {
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

    case "memory":
      return state.playbackStatus === "playing"
        ? { enabled: true }
        : {
            enabled: false,
            reason: "Memory overlay is available during active playback.",
          };

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
      return state.currentTitle
        ? (id === "mark-season-watched" || id === "mark-up-to-episode") &&
          state.currentTitle.type !== "series"
          ? {
              enabled: false,
              reason: "Mark season watched requires a series episode context.",
            }
          : { enabled: true }
        : {
            enabled: false,
            reason:
              id === "share"
                ? "Play or select a title before sharing it."
                : id === "bookmark"
                  ? "Play or select a title before bookmarking it."
                  : id === "follow" || id === "unfollow"
                    ? "Play or select a title before following releases."
                    : id === "mute"
                      ? "Play or select a title before muting releases."
                      : id === "mark-unwatched"
                        ? "Play or select a title before marking it unwatched."
                        : id === "mark-season-watched" || id === "mark-up-to-episode"
                          ? "Select a series episode before marking a season watched."
                          : id === "mark-watched"
                            ? "Play or select a title before marking it watched."
                            : "Play or select a title before reclassifying it.",
          };

    case "watch":
      return { enabled: true };

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

    case "watchlist":
    case "favorites":
    case "continue":
    case "playlists":
    case "up-next":
    case "stats":
    case "sync":
    case "sync-connect-anilist":
    case "sync-connect-tmdb":
    case "sync-disconnect":
      return { enabled: true };

    case "playlist-add":
      return state.currentTitle
        ? { enabled: true }
        : {
            enabled: false,
            reason: "Select a title before adding it to Up Next.",
          };

    case "queue-season":
      return state.currentTitle?.type === "series" && state.currentEpisode
        ? { enabled: true }
        : {
            enabled: false,
            reason: "Select a series episode before queueing the rest of the season.",
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
