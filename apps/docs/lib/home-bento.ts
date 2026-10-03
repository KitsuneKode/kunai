/**
 * What the interactive bento on the home page is made of.
 *
 * Everything here is a fact about Kunai that already lives somewhere else (the
 * generated command metadata, the provider list), arranged so the page can let a
 * visitor pick a mode and watch the rest of the section answer. Nothing is typed
 * twice: the commands are looked up by id in the generated metadata at render, and
 * `test/home-bento.test.ts` fails if a command or alias named here stops existing
 * in the CLI.
 *
 * ## Modes, not media kinds
 *
 * The CLI has three modes: series (which includes movies), anime and YouTube, and
 * `Tab` cycles them in that order. The page used to say "four" and list Anime,
 * Series, Movies and YouTube, which counts kinds of media as if they were modes.
 * The modes below are the CLI's, in its order.
 */

export type BentoModeId = "series" | "anime" | "youtube";

export type BentoMode = {
  readonly id: BentoModeId;
  readonly label: string;
  /** The id of the command that switches into this mode in the generated metadata. */
  readonly commandId: string;
  /** The slash command that jumps here; it must be an alias of `commandId`. */
  readonly alias: string;
  /** The provider `mediaKinds` this mode searches. */
  readonly kinds: readonly string[];
};

/** In the order `Tab` cycles them in the shell. */
export const BENTO_MODES: readonly BentoMode[] = [
  {
    id: "series",
    label: "Series & movies",
    commandId: "series-mode",
    alias: "series",
    kinds: ["series", "movie"],
  },
  { id: "anime", label: "Anime", commandId: "anime-mode", alias: "anime", kinds: ["anime"] },
  {
    id: "youtube",
    label: "YouTube",
    commandId: "youtube-mode",
    alias: "youtube",
    kinds: ["video"],
  },
];

/** The mode the section opens on: where `Tab` starts. */
export const DEFAULT_BENTO_MODE: BentoModeId = "series";

/** A provider as the bento needs it. */
export type BentoProvider = {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly kinds: readonly string[];
};

/** Whether `provider` is searched in `mode`. */
export function servesMode(provider: Pick<BentoProvider, "kinds">, mode: BentoMode): boolean {
  return provider.kinds.some((kind) => mode.kinds.includes(kind));
}

/** The next mode in `Tab` order (or back, for `Shift+Tab`), wrapping at the ends. */
export function cycleMode(current: BentoModeId, direction: 1 | -1 = 1): BentoModeId {
  const index = BENTO_MODES.findIndex((mode) => mode.id === current);
  const length = BENTO_MODES.length;
  const next = BENTO_MODES[(index + direction + length) % length];
  return next ? next.id : DEFAULT_BENTO_MODE;
}

export type RecoveryStep = {
  readonly commandId: string;
  readonly alias: string;
  /** What the command is for, in a few words, for the tab. */
  readonly summary: string;
  /** What the shell prints, in order. The last line is the outcome. */
  readonly lines: readonly string[];
};

/**
 * The three things to reach for when playback stalls, in the order to reach for
 * them. The lines restate what each command does in the generated metadata: they
 * are a walkthrough of documented behaviour, not a recording, and they name no
 * provider because which one is next depends on the title and the day.
 */
const RECOVER: RecoveryStep = {
  commandId: "recover",
  alias: "recover",
  summary: "First step when a stream stalls",
  lines: [
    "Playback stalled",
    "Refreshing the stream from the same provider",
    "Resuming this episode",
  ],
};

const FALLBACK: RecoveryStep = {
  commandId: "fallback",
  alias: "fallback",
  summary: "Try another provider (Shift+F during playback)",
  lines: [
    "This provider is not answering",
    "Stopping the wait and moving to the next compatible provider",
    "Playing from the next provider",
  ],
};

const DIAGNOSTICS: RecoveryStep = {
  commandId: "diagnostics",
  alias: "diagnostics",
  summary: "See what happened, redacted by default",
  lines: [
    "Opening diagnostics",
    "Recent events, with URLs and tokens redacted",
    "Export a redacted file to share with a bug report",
  ],
};

export const RECOVERY_STEPS: readonly RecoveryStep[] = [RECOVER, FALLBACK, DIAGNOSTICS];

/** The step for `commandId`, or the first when it is not found. */
export function recoveryStep(commandId: string): RecoveryStep {
  return RECOVERY_STEPS.find((step) => step.commandId === commandId) ?? RECOVER;
}

export type ContinueItem = {
  readonly label: string;
  readonly commandId: string;
  /** The slash command that opens it; it must be an alias of `commandId`. */
  readonly alias: string;
};

/**
 * The ways back into something already watched or saved, each with the command that
 * opens it. The aliases are checked against the generated metadata by the tests.
 */
export const CONTINUE_ITEMS: readonly ContinueItem[] = [
  { label: "History", commandId: "history", alias: "history" },
  { label: "Release calendar", commandId: "calendar", alias: "calendar" },
  { label: "Recommendations", commandId: "recommendation", alias: "recs" },
  { label: "Offline downloads", commandId: "library", alias: "library" },
];
