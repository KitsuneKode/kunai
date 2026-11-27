// What setup decides, as data
//
// The types and factory state every setup screen and the write map share. They
// live apart from `setup-shell.tsx` so the screens' pure helpers can import
// them without importing the shell that renders those screens.

import {
  RECOMMENDED_AUDIO_PREFERENCE,
  RECOMMENDED_SUBTITLE_PREFERENCE,
} from "@/domain/media/media-preferences";

/**
 * Which screens a run walks.
 *
 * - `quick` — a first launch: what you watch plus the machine verdict, then the
 *   consent screen. Everything else keeps the value the config already has.
 * - `full` — `/setup` and `kunai --setup` start at Dependencies. The first
 *   quick screen's `m` shortcut joins at Language, screen 3 of 6.
 */
export type SetupFlow = "quick" | "full";

export type SetupScreenId =
  | "start"
  | "deps"
  | "mode"
  | "language"
  | "library"
  | "analytics"
  | "done";

export const SETUP_SCREENS = {
  quick: ["start", "analytics"],
  full: ["deps", "mode", "language", "library", "analytics", "done"],
} as const satisfies Record<SetupFlow, readonly SetupScreenId[]>;

export const SETUP_SCREEN_CONTEXT: Record<SetupScreenId, string> = {
  start: "welcome",
  deps: "welcome",
  mode: "what you watch",
  language: "language",
  library: "playback & downloads",
  analytics: "usage ping",
  done: "ready",
};

/**
 * Three outcomes, because "skipped" was doing two incompatible jobs.
 *
 * - `completed` — the user answered every step.
 * - `defaults`  — the user waved past some or all of it. The recommended
 *   configuration is written. Previously this wrote *nothing*: `skip()` built
 *   prefs and the caller discarded them, so skipping setup left the install
 *   unconfigured while telling the user it was set up.
 * - `aborted`   — esc. Nothing is written but the onboarding version, so a
 *   deliberate bail-out never rewrites settings the user already had.
 */
export type SetupFlowResult = "completed" | "defaults" | "aborted";

export type SetupLanguageLane = "series" | "movie" | "anime" | "youtube";
export type SetupLanguageProfile = {
  readonly audio: string;
  readonly subtitle: string;
};
export type SetupLanguageProfiles = Readonly<Record<SetupLanguageLane, SetupLanguageProfile>>;

export const SETUP_LANGUAGE_LANES: readonly {
  readonly value: SetupLanguageLane;
  readonly label: string;
}[] = [
  { value: "series", label: "Shows" },
  { value: "movie", label: "Movies" },
  { value: "anime", label: "Anime" },
  { value: "youtube", label: "YouTube" },
];

/** Move between media-type language profiles with a wrapping, reversible cycle. */
export function cycleSetupLanguageLane(
  current: SetupLanguageLane,
  delta: number,
): SetupLanguageLane {
  const index = SETUP_LANGUAGE_LANES.findIndex((lane) => lane.value === current);
  const safeIndex = index >= 0 ? index : 0;
  const next = (safeIndex + delta) % SETUP_LANGUAGE_LANES.length;
  const wrapped = next < 0 ? next + SETUP_LANGUAGE_LANES.length : next;
  return SETUP_LANGUAGE_LANES[wrapped]?.value ?? "series";
}

export interface SetupPrefs {
  mode: "series" | "anime" | "youtube";
  languageProfiles: SetupLanguageProfiles;
  autoNext: boolean;
  skipIntro: boolean;
  skipCredits: boolean;
  downloadsEnabled: boolean;
  downloadQuality: string;
  /**
   * Intent only. The OAuth and IPC handoffs run *after* config commits, so a
   * browser that never opens costs an account link and not the whole wizard.
   */
  connectAniList: boolean;
  connectTmdb: boolean;
  presenceDiscord: boolean;
  /**
   * Setup-time analytics choice before DO_NOT_TRACK / CI resolution.
   *
   * `unchanged` is not "off" — it means the consent screen was never reached, so
   * whatever the user already had must survive. Collapsing it into `disabled`
   * would silently opt out someone who had previously opted in and then reran
   * setup and pressed accept-all. Only a keystroke on that screen moves this
   * value, in either direction.
   */
  analyticsChoice: "enabled" | "disabled" | "unchanged";
}

/**
 * What every control starts from.
 *
 * `runSetupWizard` builds this from the live config so a rerun shows what is
 * really set. The factory default here is only what an untouched install would
 * answer; hydrating from it instead of hardcoded literals is what stops a rerun
 * from silently severing a linked tracker or rewriting a preference the user
 * already made (#228).
 */
export interface SetupInitialState {
  readonly mode: "series" | "anime" | "youtube";
  readonly languageProfiles: SetupLanguageProfiles;
  readonly autoNext: boolean;
  readonly skipIntro: boolean;
  readonly skipCredits: boolean;
  readonly downloadsEnabled: boolean;
  readonly downloadQuality: string;
  readonly anilistSync: boolean;
  readonly tmdbSync: boolean;
  readonly presenceDiscord: boolean;
}

export const FACTORY_INITIAL_STATE: SetupInitialState = {
  mode: "series",
  languageProfiles: recommendedLanguageProfiles(),
  autoNext: false,
  skipIntro: false,
  skipCredits: false,
  downloadsEnabled: false,
  downloadQuality: "1080p",
  anilistSync: false,
  tmdbSync: false,
  presenceDiscord: false,
};

/** The value `s` ("use recommended") restores on a screen, per screen kind. */
export const MODE_RECOMMENDED = "series";
export const DOWNLOAD_QUALITY_RECOMMENDED = "1080p";

export function recommendedLanguageProfiles(): SetupLanguageProfiles {
  const profile = (): SetupLanguageProfile => ({
    audio: RECOMMENDED_AUDIO_PREFERENCE,
    subtitle: RECOMMENDED_SUBTITLE_PREFERENCE,
  });
  return {
    series: profile(),
    movie: profile(),
    anime: profile(),
    youtube: profile(),
  };
}
