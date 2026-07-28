import type { ShellAction } from "@/app-shell/types";
import type { PostPlayState } from "@/domain/playback/post-play-state";

export type TitleControlSurface =
  | "browse"
  | "library"
  | "loading"
  | "playing"
  | "post-play"
  | "history";

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
  /** Leading glyph, so a row is identifiable before it is read. */
  readonly icon?: string;
  /** Discards data or resets state. Rendered so it cannot be picked by accident. */
  readonly destructive?: boolean;
};

/**
 * Glyphs live in one map rather than baked into each label, so the icon
 * vocabulary stays consistent and a label can be rewritten by `labelFor`
 * without losing its mark.
 */
const ACTION_ICONS: Partial<Record<TitleControlActionId, string>> = {
  play: "▶",
  resume: "▶",
  restart: "↻",
  replay: "↻",
  next: "⏭",
  previous: "⏮",
  "next-season": "⏩",
  "pick-episode": "☰",
  cancel: "✕",
  stop: "■",
  source: "≡",
  quality: "◆",
  "lazy-resolve-source": "⣷",
  "switch-provider": "⇄",
  "recompute-sources": "↺",
  fallback: "⤳",
  recover: "✚",
  "purge-episode-cache": "⌫",
  "purge-title-cache": "⌫",
  "clear-cache": "⌫",
  "reset-provider-health": "⟲",
  "forget-title-provider-preference": "⌫",
  download: "↓",
  "mark-watched": "✓",
  "mark-unwatched": "○",
  "mark-season-watched": "✓",
  share: "↗",
  bookmark: "★",
  watchlist: "★",
  search: "⌕",
  diagnostics: "⚙",
  setup: "⚙",
};

/**
 * Irreversible or state-resetting actions. These sit next to ordinary ones in
 * the same list, so without a distinct tone "Purge title cache" reads exactly
 * like "Switch provider" — one keystroke apart from each other.
 */
const DESTRUCTIVE_ACTIONS: ReadonlySet<TitleControlActionId> = new Set([
  "purge-episode-cache",
  "purge-title-cache",
  "clear-cache",
  "reset-provider-health",
  "forget-title-provider-preference",
  "mark-unwatched",
]);

export type TitleControlContext = {
  readonly surface: TitleControlSurface;
  readonly titleName?: string;
  readonly titleType?: "series" | "movie";
  readonly isAnime?: boolean;
  readonly hasTitle?: boolean;
  readonly hasTitleProviderPreference?: boolean;
  readonly hasHistory?: boolean;
  /**
   * The downloads capability from config. Omitted means "not stated" and leaves
   * `download` in place, so a context built without it does not silently lose
   * an action.
   */
  readonly downloadsEnabled?: boolean;
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
  /** Poster for the Current Selection preview pane. */
  readonly posterUrl?: string;
  // Concrete episode identity, so a row can read "Next episode S1E2 · Blue Cat"
  // rather than a bare "Next episode". A generic label forces the reader to
  // remember where they were; naming the target is what makes the menu legible.
  readonly currentSeason?: number;
  readonly currentEpisodeNumber?: number;
  readonly currentEpisodeName?: string;
  /** Already-formatted by the session reducer (e.g. `S1E2`); do not rebuild it. */
  readonly nextEpisodeLabel?: string;
  readonly nextEpisodeName?: string;
  readonly resumeAtLabel?: string;
};

type ActionSpec = {
  readonly id: TitleControlActionId;
  readonly label: string;
  readonly detail?: string;
  readonly group: TitleControlActionGroup;
  readonly shellAction?: ShellAction;
  /** Overrides `label` when the context can name the concrete target. */
  readonly labelFor?: (ctx: TitleControlContext) => string | undefined;
  /** Overrides `detail` when the context can describe the concrete target. */
  readonly detailFor?: (ctx: TitleControlContext) => string | undefined;
  readonly when: (ctx: TitleControlContext) => {
    readonly enabled: boolean;
    readonly reason?: string;
  };
};

const disabled = (reason: string) => ({ enabled: false, reason });
const enabled = () => ({ enabled: true });

/** `S1E2`, or `E2` in anime mode where seasons are not the unit users think in. */
function episodeTag(
  ctx: TitleControlContext,
  season: number | undefined,
  episode: number | undefined,
): string | undefined {
  if (episode === undefined) return undefined;
  if (ctx.isAnime || season === undefined) return `E${episode}`;
  return `S${season}E${episode}`;
}

/** Appends the episode name when we know it, so rows read as content not coordinates. */
function withEpisodeName(base: string, name: string | undefined): string {
  return name ? `${base} · ${name}` : base;
}

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
    labelFor: (ctx) => {
      const tag = episodeTag(ctx, ctx.currentSeason, ctx.currentEpisodeNumber);
      return tag ? `Resume ${tag}` : undefined;
    },
    detailFor: (ctx) =>
      ctx.resumeAtLabel
        ? withEpisodeName(`Continue from ${ctx.resumeAtLabel}`, ctx.currentEpisodeName)
        : undefined,
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
    labelFor: (ctx) => (ctx.nextEpisodeLabel ? `Next episode  ${ctx.nextEpisodeLabel}` : undefined),
    detailFor: (ctx) =>
      ctx.nextEpisodeLabel
        ? withEpisodeName("Advance to the next released episode", ctx.nextEpisodeName)
        : undefined,
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
    labelFor: (ctx) => (ctx.isAnime ? "Pick episode…" : "Pick season & episode…"),
    detailFor: () => "Choose manually from metadata",
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
  // History rows are resumable catalog entries, not live playback, so this
  // mirrors `library` rather than `playing`: no stop/quality/cancel, but full
  // resume, episode selection, and download.
  history: [
    "play",
    "resume",
    "pick-episode",
    "switch-provider",
    "download",
    "mark-watched",
    "mark-unwatched",
    "share",
    "purge-title-cache",
    "forget-title-provider-preference",
    "diagnostics",
  ],
  // Episode navigation belongs here, not just on `playing`. This is an
  // allow-list, so omitting these filtered them out before `when()` ever ran:
  // opening the menu mid-resolve for a series showed only recovery actions and
  // dropped "Pick season & episode" entirely, even though it was applicable.
  // Redirecting to a different episode is a normal thing to want while a
  // stream is still resolving.
  loading: [
    "pick-episode",
    "next",
    "previous",
    "next-season",
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
    label: spec.labelFor?.(ctx) ?? spec.label,
    detail: spec.detailFor?.(ctx) ?? spec.detail,
    group: spec.group,
    shellAction: spec.shellAction,
    enabled: state.enabled,
    reason: state.reason,
    ...(ACTION_ICONS[spec.id] ? { icon: ACTION_ICONS[spec.id] } : {}),
    ...(DESTRUCTIVE_ACTIONS.has(spec.id) ? { destructive: true } : {}),
  };
}

/**
 * A capability turned off in config removes its actions outright rather than
 * disabling them. A permanently greyed row with an unchangeable reason is noise
 * on every menu; the setting is where that decision belongs.
 */
function isCapabilityAvailable(actionId: TitleControlActionId, ctx: TitleControlContext): boolean {
  return actionId === "download" ? ctx.downloadsEnabled !== false : true;
}

/** Pure selector: context-relevant title-control actions for the active surface. */
export function buildTitleControlActions(ctx: TitleControlContext): readonly TitleControlAction[] {
  const allowed = new Set(SURFACE_ACTION_IDS[ctx.surface]);
  return ACTION_SPECS.filter(
    (spec) => allowed.has(spec.id) && isCapabilityAvailable(spec.id, ctx),
  ).map((spec) => buildAction(spec, ctx));
}
