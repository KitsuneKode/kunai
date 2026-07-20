import type { ShellAction } from "@/app-shell/types";
import type { PostPlayState } from "@/domain/playback/post-play-state";

export type TitleControlSurface = "browse" | "library" | "loading" | "playing" | "post-play";

export type TitleControlActionGroup = "primary" | "providers-data" | "this-title";

export type TitleControlActionId =
  | "play"
  | "resume"
  | "restart"
  | "next"
  | "previous"
  | "pick-episode"
  | "cancel"
  | "stop"
  | "source"
  | "quality"
  | "lazy-resolve-source"
  | "switch-provider"
  | "recompute-sources"
  | "purge-episode-cache"
  | "purge-title-cache"
  | "reset-provider-health"
  | "clear-cache"
  | "forget-title-provider-preference"
  | "download"
  | "mark-watched"
  | "mark-unwatched"
  | "mark-season-watched"
  | "share"
  | "diagnostics"
  | "bookmark"
  | "search"
  | "replay"
  | "next-season"
  | "fallback"
  | "recover"
  | "watchlist"
  | "setup";

export type TitleControlAction = {
  readonly id: TitleControlActionId;
  readonly label: string;
  readonly detail?: string;
  readonly enabled: boolean;
  readonly reason?: string;
  readonly group: TitleControlActionGroup;
  readonly shellAction?: ShellAction;
};

export type TitleControlContext = {
  readonly surface: TitleControlSurface;
  readonly titleName?: string;
  readonly titleType?: "series" | "movie";
  readonly isAnime?: boolean;
  readonly hasTitle?: boolean;
  readonly hasTitleProviderPreference?: boolean;
  readonly hasHistory?: boolean;
  readonly hasSavedPosition?: boolean;
  readonly historyFinished?: boolean;
  readonly hasNextEpisode?: boolean;
  readonly hasPreviousEpisode?: boolean;
  readonly hasNextSeason?: boolean;
  readonly seriesComplete?: boolean;
  readonly seasonCount?: number;
  readonly isFirstWatch?: boolean;
  readonly providerCount?: number;
  readonly providerName?: string;
  readonly failedProvider?: boolean;
  readonly isLoading?: boolean;
  readonly isPlaying?: boolean;
  readonly cancellable?: boolean;
  readonly hasStreamCandidates?: boolean;
  readonly hasResolvedStream?: boolean;
  readonly postPlayKind?: PostPlayState["kind"];
  readonly canResume?: boolean;
};

type ActionSpec = {
  readonly id: TitleControlActionId;
  readonly label: string;
  readonly detail?: string;
  readonly group: TitleControlActionGroup;
  readonly shellAction?: ShellAction;
  readonly when: (ctx: TitleControlContext) => {
    readonly enabled: boolean;
    readonly reason?: string;
  };
};

const disabled = (reason: string) => ({ enabled: false, reason });
const enabled = () => ({ enabled: true });

const ACTION_SPECS: readonly ActionSpec[] = [
  {
    id: "play",
    label: "Play from start",
    detail: "Begin this title from episode 1",
    group: "primary",
    shellAction: "resume",
    when: (ctx) =>
      ctx.surface === "browse" || ctx.surface === "library"
        ? ctx.hasTitle
          ? enabled()
          : disabled("Select a title first")
        : disabled("Not available on this surface"),
  },
  {
    id: "resume",
    label: "Resume",
    detail: "Continue from your saved position",
    group: "primary",
    shellAction: "resume",
    when: (ctx) => {
      if (ctx.surface === "post-play") {
        return ctx.canResume ? enabled() : disabled("Nothing to resume");
      }
      if (ctx.surface === "browse" || ctx.surface === "library") {
        return ctx.hasSavedPosition ? enabled() : disabled("No saved position for this title");
      }
      return disabled("Resume is not available while playback is active");
    },
  },
  {
    id: "restart",
    label: "Replay episode",
    group: "primary",
    shellAction: "replay",
    when: (ctx) =>
      ctx.surface === "post-play" || ctx.surface === "playing"
        ? enabled()
        : disabled("Start playback to replay"),
  },
  {
    id: "next",
    label: "Next episode",
    group: "primary",
    shellAction: "next",
    when: (ctx) =>
      ctx.hasNextEpisode && !ctx.seriesComplete ? enabled() : disabled("No next episode available"),
  },
  {
    id: "previous",
    label: "Previous episode",
    group: "primary",
    shellAction: "previous",
    when: (ctx) => (ctx.hasPreviousEpisode ? enabled() : disabled("No previous episode available")),
  },
  {
    id: "pick-episode",
    label: "Pick episode",
    detail: "Choose season and episode manually",
    group: "primary",
    shellAction: "pick-episode",
    when: (ctx) =>
      ctx.titleType === "series" ? enabled() : disabled("Episode selection is only for series"),
  },
  {
    id: "next-season",
    label: "Next season",
    group: "primary",
    shellAction: "next-season",
    when: (ctx) => (ctx.hasNextSeason ? enabled() : disabled("No next season available")),
  },
  {
    id: "cancel",
    label: "Cancel loading",
    group: "primary",
    shellAction: "quit",
    when: (ctx) =>
      ctx.surface === "loading" && ctx.cancellable
        ? enabled()
        : disabled("Loading cannot be cancelled right now"),
  },
  {
    id: "stop",
    label: "Stop playback",
    group: "primary",
    shellAction: "quit",
    when: (ctx) =>
      ctx.surface === "playing" || (ctx.surface === "loading" && ctx.isPlaying)
        ? enabled()
        : disabled("Playback is not active"),
  },
  {
    id: "source",
    label: "Choose source",
    group: "primary",
    shellAction: "source",
    when: (ctx) =>
      ctx.hasStreamCandidates || ctx.hasResolvedStream
        ? enabled()
        : disabled("Resolve a stream first"),
  },
  {
    id: "quality",
    label: "Choose quality",
    group: "primary",
    shellAction: "quality",
    when: (ctx) => (ctx.hasResolvedStream ? enabled() : disabled("Resolve a stream first")),
  },
  {
    id: "lazy-resolve-source",
    label: "Resolve & choose source",
    detail: "Background resolve without starting mpv",
    group: "primary",
    shellAction: "recompute",
    when: (ctx) => {
      if (ctx.surface === "browse" || ctx.surface === "library") {
        return disabled("Start playback to resolve sources");
      }
      if (ctx.surface === "loading" || ctx.surface === "playing" || ctx.surface === "post-play") {
        return enabled();
      }
      return disabled("Not available on this surface");
    },
  },
  {
    id: "recover",
    label: "Recover playback",
    group: "primary",
    shellAction: "recover",
    when: (ctx) =>
      ctx.surface === "post-play" && ctx.postPlayKind === "did-not-start"
        ? enabled()
        : disabled("Recovery is only needed after a failed start"),
  },
  {
    id: "fallback",
    label: "Try another provider",
    group: "primary",
    shellAction: "fallback",
    when: (ctx) =>
      (ctx.surface === "loading" || ctx.surface === "post-play") && (ctx.providerCount ?? 0) > 1
        ? enabled()
        : disabled("No alternate provider available"),
  },
  {
    id: "switch-provider",
    label: "Switch provider",
    group: "providers-data",
    shellAction: "provider",
    when: (ctx) =>
      (ctx.providerCount ?? 0) > 1 ? enabled() : disabled("Only one provider is available"),
  },
  {
    id: "recompute-sources",
    label: "Recompute sources",
    group: "providers-data",
    shellAction: "recompute",
    when: (ctx) =>
      ctx.surface === "loading" || ctx.surface === "playing" || ctx.surface === "post-play"
        ? enabled()
        : disabled("Start playback to recompute sources"),
  },
  {
    id: "purge-episode-cache",
    label: "Purge episode cache",
    group: "providers-data",
    shellAction: "clear-cache",
    when: (ctx) =>
      ctx.hasTitle && ctx.titleType === "series"
        ? enabled()
        : disabled("Select a series episode first"),
  },
  {
    id: "purge-title-cache",
    label: "Purge title cache",
    group: "providers-data",
    shellAction: "clear-cache",
    when: (ctx) => (ctx.hasTitle ? enabled() : disabled("Select a title first")),
  },
  {
    id: "reset-provider-health",
    label: "Reset provider health",
    group: "providers-data",
    shellAction: "reset-provider-health",
    when: (ctx) =>
      ctx.failedProvider || (ctx.providerCount ?? 0) > 0
        ? enabled()
        : disabled("No provider health data to reset"),
  },
  {
    id: "clear-cache",
    label: "Clear stream cache",
    group: "providers-data",
    shellAction: "clear-cache",
    when: () => enabled(),
  },
  {
    id: "forget-title-provider-preference",
    label: "Forget preference for this title",
    detail: "Clear the sticky provider pin for this title only",
    group: "providers-data",
    shellAction: "forget-title-provider-preference",
    when: (ctx) =>
      ctx.hasTitle && ctx.hasTitleProviderPreference
        ? enabled()
        : disabled("No saved provider preference for this title"),
  },
  {
    id: "download",
    label: "Download",
    group: "this-title",
    shellAction: "download",
    when: (ctx) => (ctx.hasTitle ? enabled() : disabled("Select a title first")),
  },
  {
    id: "mark-watched",
    label: "Mark watched",
    group: "this-title",
    shellAction: "mark-watched",
    when: (ctx) =>
      ctx.hasTitle &&
      (ctx.surface === "playing" || ctx.surface === "post-play" || ctx.surface === "browse")
        ? enabled()
        : disabled("Select a title to mark watched"),
  },
  {
    id: "mark-unwatched",
    label: "Mark unwatched",
    group: "this-title",
    shellAction: "mark-unwatched",
    when: (ctx) =>
      ctx.hasTitle &&
      (ctx.surface === "playing" || ctx.surface === "post-play" || ctx.surface === "browse")
        ? enabled()
        : disabled("Select a title to mark unwatched"),
  },
  {
    id: "mark-season-watched",
    label: "Mark season watched",
    group: "this-title",
    shellAction: "mark-season-watched",
    when: (ctx) =>
      ctx.hasTitle &&
      ctx.titleType === "series" &&
      (ctx.surface === "playing" || ctx.surface === "post-play" || ctx.surface === "browse")
        ? enabled()
        : disabled("Select a series episode to mark the season watched"),
  },
  {
    id: "share",
    label: "Share link",
    group: "this-title",
    shellAction: "share",
    when: (ctx) => (ctx.hasTitle ? enabled() : disabled("Select a title first")),
  },
  {
    id: "bookmark",
    label: "Add to watchlist",
    group: "this-title",
    shellAction: "bookmark",
    when: (ctx) => (ctx.hasTitle ? enabled() : disabled("Select a title first")),
  },
  {
    id: "watchlist",
    label: "Open watchlist",
    group: "this-title",
    shellAction: "watchlist",
    when: (ctx) =>
      ctx.surface === "post-play" ? enabled() : disabled("Open watchlist after playback"),
  },
  {
    id: "search",
    label: "Search for something else",
    group: "this-title",
    shellAction: "search",
    when: (ctx) =>
      ctx.surface === "post-play" ? enabled() : disabled("Search is available after playback"),
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    group: "this-title",
    shellAction: "diagnostics",
    when: () => enabled(),
  },
  {
    id: "setup",
    label: "Setup wizard",
    detail: "Configure providers, language, and playback defaults",
    group: "this-title",
    shellAction: "setup",
    when: (ctx) =>
      ctx.surface === "browse" || ctx.surface === "post-play"
        ? enabled()
        : disabled("Setup is available from browse or after playback"),
  },
];

const SURFACE_ACTION_IDS: Record<TitleControlSurface, readonly TitleControlActionId[]> = {
  browse: [
    "play",
    "resume",
    "pick-episode",
    "lazy-resolve-source",
    "switch-provider",
    "purge-episode-cache",
    "purge-title-cache",
    "reset-provider-health",
    "clear-cache",
    "forget-title-provider-preference",
    "download",
    "mark-watched",
    "mark-unwatched",
    "share",
    "bookmark",
    "setup",
    "diagnostics",
  ],
  library: [
    "play",
    "resume",
    "pick-episode",
    "switch-provider",
    "download",
    "share",
    "diagnostics",
  ],
  loading: [
    "cancel",
    "lazy-resolve-source",
    "switch-provider",
    "recompute-sources",
    "fallback",
    "source",
    "purge-episode-cache",
    "purge-title-cache",
    "reset-provider-health",
    "diagnostics",
  ],
  playing: [
    "next",
    "previous",
    "pick-episode",
    "source",
    "quality",
    "lazy-resolve-source",
    "switch-provider",
    "recompute-sources",
    "stop",
    "download",
    "mark-watched",
    "mark-unwatched",
    "mark-season-watched",
    "share",
    "diagnostics",
  ],
  "post-play": [
    "resume",
    "restart",
    "next",
    "next-season",
    "pick-episode",
    "recover",
    "fallback",
    "lazy-resolve-source",
    "source",
    "switch-provider",
    "watchlist",
    "search",
    "mark-watched",
    "mark-unwatched",
    "mark-season-watched",
    "share",
    "setup",
    "diagnostics",
  ],
};

function buildAction(spec: ActionSpec, ctx: TitleControlContext): TitleControlAction {
  const state = spec.when(ctx);
  return {
    id: spec.id,
    label: spec.label,
    detail: spec.detail,
    group: spec.group,
    shellAction: spec.shellAction,
    enabled: state.enabled,
    reason: state.reason,
  };
}

/** Pure selector: context-relevant title-control actions for the active surface. */
export function buildTitleControlActions(ctx: TitleControlContext): readonly TitleControlAction[] {
  const allowed = new Set(SURFACE_ACTION_IDS[ctx.surface]);
  return ACTION_SPECS.filter((spec) => allowed.has(spec.id)).map((spec) => buildAction(spec, ctx));
}
