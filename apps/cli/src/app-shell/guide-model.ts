import {
  COMMAND_CONTEXTS,
  type AppCommandId,
  type ResolvedAppCommand,
} from "@/domain/session/command-registry";

/**
 * The `/guide` directory — a browsable answer to "what can Kunai do?", grouped
 * by task rather than by surface. Ordering and grouping here are the editorial
 * content; everything else is derived. Row text comes from the command
 * registry, and each row's home surface comes from `COMMAND_CONTEXTS` plus the
 * set of actions the current surface already routes, so a command that gains
 * overlay support re-tags itself instead of leaving a stale label behind.
 *
 * `guide-model.test.ts` pins every entry to a real registry id and asserts the
 * derived surface tags stay honest.
 */
export type GuideEntry = {
  readonly command: AppCommandId;
  /** One-line context shown under the command's own description. */
  readonly note?: string;
};

export type GuideSection = {
  readonly title: string;
  readonly blurb: string;
  readonly entries: readonly GuideEntry[];
};

export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    title: "Find something to watch",
    blurb: "Search is the front door — these are the other ways in.",
    entries: [
      { command: "search" },
      { command: "trending" },
      { command: "recommendation" },
      { command: "calendar" },
      { command: "random" },
      { command: "filters" },
    ],
  },
  {
    title: "Pick up where you left off",
    blurb: "Progress, queues, and the things you saved for later.",
    entries: [
      { command: "continue" },
      { command: "history" },
      { command: "up-next" },
      { command: "watchlist" },
      { command: "playlists" },
      { command: "library" },
      { command: "downloads" },
    ],
  },
  {
    title: "While it's playing",
    blurb: "These live on the player and post-play screens.",
    entries: [
      { command: "next" },
      { command: "previous" },
      { command: "pick-episode" },
      { command: "replay" },
      { command: "quality" },
      { command: "audio" },
      { command: "subtitle" },
      { command: "source" },
      { command: "recover" },
      { command: "toggle-autoplay" },
      { command: "toggle-autoskip" },
      { command: "stop-after-current" },
    ],
  },
  {
    title: "Keep track of it",
    blurb: "Mark, save, and share — history fills itself in either way.",
    entries: [
      { command: "mark-watched" },
      { command: "mark-season-watched" },
      { command: "bookmark" },
      { command: "follow" },
      { command: "playlist-add" },
      { command: "queue-season" },
      { command: "share" },
      { command: "stats" },
    ],
  },
  {
    title: "Make it yours",
    blurb: "Providers, panes, the fox — the settings that change how it feels.",
    entries: [
      { command: "settings" },
      { command: "providers" },
      { command: "image-pane" },
      { command: "pet" },
      { command: "notifications" },
      { command: "sync" },
      { command: "toggle-mode" },
      { command: "update" },
    ],
  },
  {
    title: "When something's off",
    blurb: "Shortcuts, diagnostics, and the way out.",
    entries: [
      { command: "help", note: "press ? anywhere for the keybinding card" },
      { command: "diagnostics" },
      { command: "docs" },
      { command: "report-issue" },
      { command: "about" },
      { command: "quit" },
    ],
  },
];

export const GUIDE_COMMAND_IDS: readonly AppCommandId[] = GUIDE_SECTIONS.flatMap((section) =>
  section.entries.map((entry) => entry.command),
);

/**
 * Where a guide row's command actually runs. `run` means the current surface's
 * own palette already routes it — Enter can fire it in place. `search` means
 * the command belongs to the browse/search surface, so Enter can hand it to
 * the mounted browse session. `playing`/`post-play` are teaching tags only:
 * those screens are session states, not places an overlay can send the user.
 */
export type GuideSurface = "run" | "search" | "playing" | "post-play";

const PLAYING_COMMANDS: ReadonlySet<string> = new Set(COMMAND_CONTEXTS.activePlayback);
const POST_PLAY_COMMANDS: ReadonlySet<string> = new Set(COMMAND_CONTEXTS.postPlayback);

export function guideSurfaceFor(
  command: AppCommandId,
  runnableHere: ReadonlySet<string>,
  searchSurface: ReadonlySet<string>,
): GuideSurface {
  if (runnableHere.has(command)) return "run";
  if (searchSurface.has(command)) return "search";
  if (PLAYING_COMMANDS.has(command)) return "playing";
  if (POST_PLAY_COMMANDS.has(command)) return "post-play";
  return "search";
}

export type GuideRow = {
  readonly command: AppCommandId;
  readonly invocation: string;
  readonly description: string;
  readonly note: string | undefined;
  readonly enabled: boolean;
  readonly reason: string | undefined;
  readonly surface: GuideSurface;
};

export type GuideSectionRows = {
  readonly title: string;
  readonly blurb: string;
  readonly rows: readonly GuideRow[];
};

/**
 * Resolve the curated sections against live command state so rows show the
 * same label, description, and disabled reason the palette would.
 */
export function buildGuideRows({
  commands,
  runnableHere,
  searchSurface,
}: {
  readonly commands: readonly ResolvedAppCommand[];
  readonly runnableHere: ReadonlySet<string>;
  readonly searchSurface: ReadonlySet<string>;
}): readonly GuideSectionRows[] {
  const byId = new Map(commands.map((command) => [command.id, command]));
  return GUIDE_SECTIONS.map((section) => ({
    title: section.title,
    blurb: section.blurb,
    rows: section.entries.flatMap((entry) => {
      const resolved = byId.get(entry.command);
      if (!resolved) return [];
      return [
        {
          command: entry.command,
          invocation: `/${resolved.aliases[0] ?? resolved.label.toLowerCase()}`,
          description: resolved.description || resolved.label,
          note: entry.note,
          enabled: resolved.enabled,
          reason: resolved.reason,
          surface: guideSurfaceFor(entry.command, runnableHere, searchSurface),
        },
      ];
    }),
  }));
}

export const GUIDE_SURFACE_TAGS = {
  run: "enter runs",
  search: "→ search screen",
  playing: "→ while playing",
  "post-play": "→ after watching",
} as const satisfies Record<GuideSurface, string>;

/** Feedback note for Enter on a row whose command lives on another screen. */
export const GUIDE_SURFACE_NOTE = {
  search: "lives on the search screen — Esc back, then try it",
  playing: "runs while something is playing",
  "post-play": "runs on the post-play screen",
} as const satisfies Record<Exclude<GuideSurface, "run">, string>;
