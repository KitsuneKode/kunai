// =============================================================================
// setup-shell.tsx — first run, in seven framed screens
//
// Every screen asks something or pays something off, and every one of them
// wears the Sakura shell frame. Setup used to be the only surface in Kunai
// without it, which is why it read as a different application.
//
// Layout and grammar: `.reference/design/cli/kunai-sakura-systems.html` and
// `01-shell-footer-contract.md`. Skip contract: `s` takes this step's
// recommendation, `S` takes every remaining one. `esc`/`q` discard and quit —
// but only once nothing is decided yet; past screen one they ask first.
//
// Every control hydrates from the current config (`SetupInitialState`), so a
// rerun shows what is really set and completing writes back exactly what the
// screens showed — rerunning can never silently sever a linked account.
// =============================================================================

import {
  AUDIO_PREFERENCE_OPTIONS,
  RECOMMENDED_AUDIO_PREFERENCE,
  RECOMMENDED_SUBTITLE_PREFERENCE,
  SUBTITLE_PREFERENCE_OPTIONS,
} from "@/domain/media/media-preferences";
import type { CapabilitySnapshot } from "@/ui";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

import packageJson from "../../package.json" with { type: "json" };
import { useFrameTick } from "./primitives/SakuraPetal";
import { mountRootContent } from "./root-content-state";
import { AnalyticsScreen, ANALYTICS_ON_INDEX, ANALYTICS_OFF_INDEX } from "./setup/AnalyticsScreen";
import { buildDependencyRows, type ScopedDependencyRow } from "./setup/dependency-rows";
import { SetupFrame, setupContentWidth, type FooterKey } from "./setup/SetupFrame";
import {
  DependencyScreen,
  dependencyFooter,
  DOWNLOAD_QUALITIES,
  DoneScreen,
  LanguageScreen,
  LibraryScreen,
  MODE_OPTIONS,
  ModeScreen,
  PlaybackScreen,
  type SummaryLine,
} from "./setup/SetupScreens";
import { ViewportResizeGate } from "./shell-primitives";
import { palette } from "./shell-theme";
import { useDebouncedViewportPolicy, useShellDimensions } from "./use-viewport-policy";

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = "deps" | "mode" | "language" | "playback" | "library" | "analytics" | "done";

const SCREEN_ORDER: readonly Screen[] = [
  "deps",
  "mode",
  "language",
  "playback",
  "library",
  "analytics",
  "done",
];

const SCREEN_CONTEXT: Record<Screen, string> = {
  deps: "welcome",
  mode: "what you watch",
  language: "language",
  playback: "playback",
  library: "downloads & accounts",
  analytics: "usage ping",
  done: "ready",
};

/**
 * The consent screen must describe *this* machine. It used to print the literal
 * `"version": "0.3.0", "os": "linux", "arch": "x64"`, which made the one screen
 * that has to be exactly true a false statement on macOS and Windows.
 */
export const KUNAI_VERSION: string = packageJson.version;

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
  readonly key: string;
}[] = [
  { value: "series", label: "Shows", key: "1" },
  { value: "movie", label: "Movies", key: "2" },
  { value: "anime", label: "Anime", key: "3" },
  { value: "youtube", label: "YouTube", key: "4" },
];

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
  autoNext: true,
  skipIntro: true,
  skipCredits: true,
  downloadsEnabled: false,
  downloadQuality: "1080p",
  anilistSync: false,
  tmdbSync: false,
  presenceDiscord: false,
};

/** The value `s` ("use recommended") restores on a screen, per screen kind. */
const MODE_RECOMMENDED = "series";
const DOWNLOAD_QUALITY_RECOMMENDED = "1080p";

function recommendedLanguageProfiles(): SetupLanguageProfiles {
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

function languageLaneForMode(mode: SetupPrefs["mode"]): SetupLanguageLane {
  return mode;
}

/** Index of `value`, or 0 when it somehow left the list — never -1. */
function indexOfValue(values: readonly string[], value: string): number {
  const index = values.indexOf(value);
  return index >= 0 ? index : 0;
}

/** Index of the recommended value, or 0 when it somehow left the catalog. */
function recommendedIndex(
  options: readonly { readonly value: string }[],
  recommended: string,
): number {
  const index = options.findIndex((option) => option.value === recommended);
  return index >= 0 ? index : 0;
}

const RECHECK_TICK_MS = 150;

// ─── Main SetupShell component ────────────────────────────────────────────────

export function SetupShell({
  snapshot: initialSnapshot,
  finish,
  onRecheck,
  downloadPath = "your data directory",
  initial = FACTORY_INITIAL_STATE,
}: {
  snapshot: CapabilitySnapshot;
  /** Called with the outcome, the chosen prefs, and how deep the user got. */
  finish: (result: SetupFlowResult, prefs: SetupPrefs, answeredScreens: number) => void;
  /** Re-probe the machine. Absent in tests that do not exercise `[r]`. */
  onRecheck?: () => Promise<CapabilitySnapshot>;
  downloadPath?: string;
  /** Current configuration, hydrated into every control. See #228. */
  initial?: SetupInitialState;
}) {
  // Columns only. The frame takes its height from its container via flexGrow —
  // sizing to `stdout.rows` is what pushed the footer off the bottom of the
  // screen, because setup mounts inside the app shell's box, not the terminal.
  const { cols } = useShellDimensions();
  // Same policy the gate below renders against. While it is too small the
  // screens are not visible, so keystrokes must not steer screens the user
  // cannot see.
  const viewport = useDebouncedViewportPolicy("picker");

  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [rechecking, setRechecking] = useState(false);
  const [screenIdx, setScreenIdx] = useState(0);
  /** Deepest screen reached — an abort after this point was a real decision. */
  const deepestRef = React.useRef(0);
  const [confirmingAbort, setConfirmingAbort] = useState(false);

  const [depIdx, setDepIdx] = useState(0);
  const [showFix, setShowFix] = useState(false);
  const [modeIdx, setModeIdx] = useState(() =>
    indexOfValue(
      MODE_OPTIONS.map((o) => o.value),
      initial.mode,
    ),
  );
  const [languageProfiles, setLanguageProfiles] = useState(initial.languageProfiles);
  const [languageLane, setLanguageLane] = useState<SetupLanguageLane>(() =>
    languageLaneForMode(initial.mode),
  );
  const [langFocus, setLangFocus] = useState<"audio" | "subtitle">("audio");
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [autoNext, setAutoNext] = useState(initial.autoNext);
  const [skipIntro, setSkipIntro] = useState(initial.skipIntro);
  const [skipCredits, setSkipCredits] = useState(initial.skipCredits);
  const [libraryIdx, setLibraryIdx] = useState(0);
  // Hydrated from config, then clamped to what is installed: a preference saved
  // while yt-dlp existed must not come back pointing at a queue that cannot run
  // — same clamp `[r]` applies when a recheck sees yt-dlp disappear.
  const [downloadsEnabled, setDownloadsEnabled] = useState(
    initial.downloadsEnabled && snapshot.ytDlp,
  );
  const [qualityIdx, setQualityIdx] = useState(() =>
    indexOfValue(DOWNLOAD_QUALITIES, initial.downloadQuality),
  );
  const [connectAniList, setConnectAniList] = useState(initial.anilistSync);
  const [connectTmdb, setConnectTmdb] = useState(initial.tmdbSync);
  const [presenceDiscord, setPresenceDiscord] = useState(initial.presenceDiscord);
  // The cursor on the consent screen. Index 0 is "turn it on" — the
  // recommendation, per the analytics contract. A cursor is not an answer.
  const [analyticsIdx, setAnalyticsIdx] = useState(ANALYTICS_ON_INDEX);
  /**
   * The consent screen's *committed* answer, written only by a key pressed
   * while that screen is showing.
   *
   * This used to be an `analyticsSeen` boolean flipped on arrival, with the
   * live cursor read at finish time. Arriving is not consenting: walking onto
   * the screen, pressing left to go back, and then pressing `S` elsewhere
   * finished the wizard with the cursor still parked on the pre-selected
   * "turn it on" — a skip path that opted the user in, which the contract in
   * AGENTS.md forbids outright. Recording the decision instead of the visit
   * closes that whole class: nothing but a keystroke on the consent screen can
   * move this, in either direction.
   */
  const [analyticsDecision, setAnalyticsDecision] =
    useState<SetupPrefs["analyticsChoice"]>("unchanged");

  const tick = useFrameTick(rechecking, RECHECK_TICK_MS);
  const screen = SCREEN_ORDER[screenIdx] as Screen;

  const depRows: readonly ScopedDependencyRow[] = buildDependencyRows(snapshot, {
    dataDir: downloadPath,
  });

  const mode = MODE_OPTIONS[modeIdx]?.value ?? "series";
  const activeLanguageProfile = languageProfiles[languageLane];
  const audioIdx = recommendedIndex(AUDIO_PREFERENCE_OPTIONS, activeLanguageProfile.audio);
  const subtitleIdx = recommendedIndex(SUBTITLE_PREFERENCE_OPTIONS, activeLanguageProfile.subtitle);

  /**
   * `analyticsChoice` is passed in rather than derived: every caller has to say
   * out loud which consent answer it is committing, and the only value that can
   * ever be `enabled` is one the consent screen recorded.
   */
  function buildPrefs(analyticsChoice: SetupPrefs["analyticsChoice"]): SetupPrefs {
    return {
      mode,
      languageProfiles,
      autoNext,
      skipIntro,
      skipCredits,
      downloadsEnabled,
      downloadQuality: DOWNLOAD_QUALITIES[qualityIdx] ?? "1080p",
      connectAniList,
      connectTmdb,
      presenceDiscord,
      analyticsChoice,
    };
  }

  function advance() {
    if (screenIdx < SCREEN_ORDER.length - 1) {
      if (screen === "mode") setLanguageLane(languageLaneForMode(mode));
      setShowFix(false);
      setConfirmingAbort(false);
      deepestRef.current = Math.max(deepestRef.current, screenIdx + 1);
      setScreenIdx((current) => current + 1);
    } else {
      finish("completed", buildPrefs(analyticsDecision), deepestRef.current);
    }
  }

  function back() {
    if (screenIdx > 0) {
      setShowFix(false);
      setConfirmingAbort(false);
      setScreenIdx((i) => i - 1);
    }
  }

  /**
   * Accept every remaining recommendation and finish.
   *
   * Analytics is excluded when the consent screen has not been reached: a
   * blanket "yes to everything" is not consent to send data. Same rule keeps
   * AniList, TMDB, and Discord off — no skip path may perform an outward-facing
   * action.
   */
  function acceptRemainingDefaults() {
    const prefs = buildPrefs(analyticsDecision);
    const remaining = new Set(SCREEN_ORDER.slice(screenIdx));
    finish(
      "defaults",
      {
        ...prefs,
        ...(remaining.has("mode") ? { mode: MODE_RECOMMENDED } : {}),
        ...(remaining.has("language") ? { languageProfiles: recommendedLanguageProfiles() } : {}),
        ...(remaining.has("playback")
          ? { autoNext: true, skipIntro: true, skipCredits: true }
          : {}),
        ...(remaining.has("library") ? { downloadQuality: DOWNLOAD_QUALITY_RECOMMENDED } : {}),
      },
      deepestRef.current,
    );
  }

  function abort() {
    finish("aborted", buildPrefs("unchanged"), deepestRef.current);
  }

  /**
   * Record the consent screen's answer. The only writer of `analyticsDecision`,
   * and it is only ever called from a key handler that has already established
   * the consent screen is the one showing — that narrowness is the guarantee.
   * The cursor follows the decision so the screen and the record agree if the
   * user steps back onto it.
   */
  function commitAnalytics(choice: "enabled" | "disabled") {
    setAnalyticsIdx(choice === "enabled" ? ANALYTICS_ON_INDEX : ANALYTICS_OFF_INDEX);
    setAnalyticsDecision(choice);
  }

  /**
   * Leaving is free before anything is decided; afterwards it costs a confirm,
   * because one stray esc at screen six must not throw away five screens of
   * answers (#230). The caller still decides what an abort means for the
   * onboarding gate — `answeredScreens` tells it whether the user ever engaged.
   */
  function requestAbort() {
    if (deepestRef.current === 0 && screenIdx === 0) {
      abort();
      return;
    }
    setConfirmingAbort(true);
  }

  /**
   * `s` — take this step's recommendation and move on. The footer promises
   * "use recommended", so the handler has to actually apply it: resetting only
   * the current screen's decision, never a standing one (#231).
   */
  function applyScreenRecommendation() {
    switch (screen) {
      case "mode":
        setModeIdx(
          indexOfValue(
            MODE_OPTIONS.map((o) => o.value),
            MODE_RECOMMENDED,
          ),
        );
        break;
      case "language":
        setLanguageProfiles(recommendedLanguageProfiles());
        break;
      case "playback":
        setAutoNext(true);
        setSkipIntro(true);
        setSkipCredits(true);
        break;
      case "library":
        // Only the quality resets. Downloads, account links, and presence are
        // standing decisions: "recommended" for those is whatever the user
        // already has, which is what hydration loaded.
        setQualityIdx(indexOfValue(DOWNLOAD_QUALITIES, DOWNLOAD_QUALITY_RECOMMENDED));
        break;
      default:
        break;
    }
  }

  function recheck() {
    if (!onRecheck || rechecking) return;
    setRechecking(true);
    void (async () => {
      try {
        const next = await onRecheck();
        setSnapshot(next);
        // A recheck can also take something away — uninstalling yt-dlp while
        // downloads are selected must not leave the choice pointing at
        // something that cannot work.
        setDownloadsEnabled((current) => current && next.ytDlp);
      } catch {
        // A failed re-probe leaves the previous snapshot standing. Setup must
        // never be blocked by a diagnostic that is itself broken.
      } finally {
        setRechecking(false);
      }
    })();
  }

  function move(delta: number) {
    const clamp = (value: number, max: number) => Math.min(Math.max(0, value), max);
    if (screen === "deps") setDepIdx((i) => clamp(i + delta, depRows.length - 1));
    else if (screen === "mode") setModeIdx((i) => clamp(i + delta, MODE_OPTIONS.length - 1));
    else if (screen === "language") {
      if (langFocus === "audio") {
        const next = clamp(audioIdx + delta, AUDIO_PREFERENCE_OPTIONS.length - 1);
        const value = AUDIO_PREFERENCE_OPTIONS[next]?.value ?? RECOMMENDED_AUDIO_PREFERENCE;
        setLanguageProfiles((current) => ({
          ...current,
          [languageLane]: { ...current[languageLane], audio: value },
        }));
      } else {
        const next = clamp(subtitleIdx + delta, SUBTITLE_PREFERENCE_OPTIONS.length - 1);
        const value = SUBTITLE_PREFERENCE_OPTIONS[next]?.value ?? RECOMMENDED_SUBTITLE_PREFERENCE;
        setLanguageProfiles((current) => ({
          ...current,
          [languageLane]: { ...current[languageLane], subtitle: value },
        }));
      }
    } else if (screen === "playback") setPlaybackIdx((i) => clamp(i + delta, 2));
    else if (screen === "library") setLibraryIdx((i) => clamp(i + delta, 4));
    else if (screen === "analytics") setAnalyticsIdx((i) => clamp(i + delta, 1));
  }

  function toggle() {
    if (screen === "playback") {
      if (playbackIdx === 0) setAutoNext((v) => !v);
      else if (playbackIdx === 1) setSkipIntro((v) => !v);
      else setSkipCredits((v) => !v);
      return;
    }
    if (screen === "library") {
      // A row whose note explains it cannot work must not flip when pressed —
      // an on glyph next to "install yt-dlp" is two statements disagreeing.
      if (libraryIdx === 0) {
        if (snapshot.ytDlp) setDownloadsEnabled((v) => !v);
        return;
      }
      if (libraryIdx === 1) {
        if (downloadsEnabled) setQualityIdx((i) => (i + 1) % DOWNLOAD_QUALITIES.length);
        return;
      }
      if (libraryIdx === 2) setConnectAniList((v) => !v);
      else if (libraryIdx === 3) setConnectTmdb((v) => !v);
      else setPresenceDiscord((v) => !v);
    }
  }

  useInput((input, key) => {
    // Below the viewport minimum the screens are not rendered; keys would steer
    // decisions the user cannot see.
    if (viewport.tooSmall) return;

    // Abort is a two-keystroke decision once anything has been answered. The
    // confirming keypress is consumed: whatever it was, it does not also act.
    if (confirmingAbort) {
      if (key.escape || input === "q" || input === "Q") abort();
      else setConfirmingAbort(false);
      return;
    }

    if (key.escape || input === "q" || input === "Q") {
      requestAbort();
      return;
    }

    // `S` — accept every remaining recommendation and finish. On the consent
    // screen it advances instead of passing through, so analytics is never
    // enabled by a keystroke aimed at everything else. Anywhere else it
    // finishes carrying whatever the consent screen has actually recorded,
    // which for a user who never answered it is `unchanged`.
    if (input === "S") {
      if (screen === "analytics") {
        commitAnalytics("disabled");
        advance();
        return;
      }
      acceptRemainingDefaults();
      return;
    }

    // `s` — take this step's recommendation and move on. It no longer ends the
    // wizard: waving past one question should not cost you the rest of setup.
    // On the consent screen "recommended" is deliberately inverted: the
    // contract says a skip may never opt anyone in.
    if (input === "s") {
      if (screen === "analytics") commitAnalytics("disabled");
      else applyScreenRecommendation();
      advance();
      return;
    }

    if (screen === "deps") {
      if (input === "r" || input === "R") {
        recheck();
        return;
      }
      if (input === "d" || input === "D") {
        setShowFix((v) => !v);
        return;
      }
    }

    if (key.return) {
      // Confirming on the consent screen is the one keystroke allowed to say
      // "enabled", and it says whatever the cursor is on when it is pressed.
      if (screen === "analytics") {
        commitAnalytics(analyticsIdx === ANALYTICS_ON_INDEX ? "enabled" : "disabled");
      }
      advance();
      return;
    }

    if (screen === "language") {
      const selectedLane = SETUP_LANGUAGE_LANES.find((lane) => lane.key === input);
      if (selectedLane) {
        setLanguageLane(selectedLane.value);
        return;
      }

      // Tab cycles the profile, because the profile is this screen's tab group.
      // Every other tabbed surface — history, downloads, analytics, library,
      // browse — already reads Tab that way, and this screen used to be the one
      // exception, with the tab group stranded on 1-4.
      if (key.tab) {
        const index = SETUP_LANGUAGE_LANES.findIndex((lane) => lane.value === languageLane);
        const count = SETUP_LANGUAGE_LANES.length;
        const next = (index + (key.shift ? -1 : 1) + count) % count;
        setLanguageLane(
          (SETUP_LANGUAGE_LANES[next] as (typeof SETUP_LANGUAGE_LANES)[number]).value,
        );
        return;
      }

      // The two columns sit left and right on screen, so the arrows walk them.
      if (key.rightArrow) {
        setLangFocus("subtitle");
        return;
      }
      if (key.leftArrow && langFocus === "subtitle") {
        setLangFocus("audio");
        return;
      }
      // Left at the leftmost column falls through to `back()` below. That is
      // what keeps "left goes back" true on every setup screen while still
      // letting the arrows mean something inside this one.
    }

    if (input === " ") {
      toggle();
      return;
    }

    if (key.leftArrow || input === "b" || input === "B") {
      back();
      return;
    }

    if (key.upArrow) {
      move(-1);
      return;
    }
    if (key.downArrow) {
      move(1);
    }
  });

  const footer = buildFooter(screen, {
    hasFix: Boolean(depRows[depIdx]?.fix),
    isFirst: screenIdx === 0,
  });

  return (
    <ViewportResizeGate kind="picker" message="Resize terminal to run setup">
      <SetupFrame
        width={cols}
        context={SCREEN_CONTEXT[screen]}
        step={screenIdx}
        totalSteps={SCREEN_ORDER.length}
        footer={footer}
      >
        {screen === "deps" ? (
          <DependencyScreen
            rows={depRows}
            selected={depIdx}
            rechecking={rechecking}
            tick={tick}
            showFix={showFix}
            contentWidth={setupContentWidth(cols)}
          />
        ) : null}
        {screen === "mode" ? <ModeScreen selected={modeIdx} /> : null}
        {screen === "language" ? (
          <LanguageScreen
            lanes={SETUP_LANGUAGE_LANES}
            activeLane={languageLane}
            profiles={languageProfiles}
            audioOptions={AUDIO_PREFERENCE_OPTIONS}
            subtitleOptions={SUBTITLE_PREFERENCE_OPTIONS}
            audioIndex={audioIdx}
            subtitleIndex={subtitleIdx}
            focus={langFocus}
          />
        ) : null}
        {screen === "playback" ? (
          <PlaybackScreen toggles={{ autoNext, skipIntro, skipCredits }} selected={playbackIdx} />
        ) : null}
        {screen === "library" ? (
          <LibraryScreen
            toggles={{
              downloadsEnabled,
              downloadQuality: DOWNLOAD_QUALITIES[qualityIdx] ?? "1080p",
              connectAniList,
              connectTmdb,
              presenceDiscord,
            }}
            selected={libraryIdx}
            ytDlpReady={snapshot.ytDlp}
            downloadPath={downloadPath}
          />
        ) : null}
        {screen === "analytics" ? <AnalyticsScreen selectedIndex={analyticsIdx} /> : null}
        {screen === "done" ? (
          <DoneScreen
            headline={describeChoice(buildPrefs(analyticsDecision))}
            summary={summaryLines(buildPrefs(analyticsDecision))}
            outstanding={outstandingLines(depRows)}
          />
        ) : null}

        {confirmingAbort ? (
          <Box marginTop={1}>
            <Text color={palette.danger} bold>
              Press esc again to quit without saving
            </Text>
            <Text color={palette.muted}> — any other key stays.</Text>
          </Box>
        ) : null}
      </SetupFrame>
    </ViewportResizeGate>
  );
}

function buildFooter(
  screen: Screen,
  context: { readonly hasFix: boolean; readonly isFirst: boolean },
): readonly FooterKey[] {
  const back: FooterKey[] = context.isFirst ? [] : [{ key: "b", label: "back" }];
  switch (screen) {
    case "deps":
      return dependencyFooter(context.hasFix);
    case "mode":
      return [
        { key: "enter", label: "confirm" },
        { key: "↑↓", label: "choose" },
        ...back,
        { key: "s", label: "recommended" },
        { key: "S", label: "remaining defaults" },
      ];
    case "language":
      // tab and ↑↓ are named in the screen body, right where they act; the
      // footer keeps only the decisions.
      return [
        { key: "enter", label: "next" },
        { key: "tab", label: "profile" },
        { key: "←→", label: "audio / subs" },
        { key: "s", label: "recommended" },
        { key: "S", label: "remaining defaults" },
        ...back,
      ];
    case "playback":
    case "library":
      return [
        { key: "space", label: "toggle" },
        { key: "↑↓", label: "choose" },
        { key: "enter", label: "next" },
        { key: "s", label: "recommended" },
        { key: "S", label: "remaining defaults" },
        ...back,
      ];
    case "analytics":
      return [
        { key: "enter", label: "confirm" },
        { key: "↑↓", label: "choose" },
        { key: "s", label: "keep it off" },
        ...back,
      ];
    case "done":
      return [
        { key: "enter", label: "start watching" },
        { key: "b", label: "change something" },
      ];
  }
}

function describeChoice(prefs: SetupPrefs): string {
  const modeLabel = MODE_OPTIONS.find((option) => option.value === prefs.mode)?.label ?? "Shows";
  return `${modeLabel} first · every profile stays editable`;
}

function summaryLines(prefs: SetupPrefs): readonly SummaryLine[] {
  const lines: SummaryLine[] = [];
  for (const lane of SETUP_LANGUAGE_LANES) {
    const profile = prefs.languageProfiles[lane.value];
    const audio =
      AUDIO_PREFERENCE_OPTIONS.find((option) => option.value === profile.audio)?.label ??
      profile.audio;
    const subtitle =
      SUBTITLE_PREFERENCE_OPTIONS.find((option) => option.value === profile.subtitle)?.label ??
      profile.subtitle;
    lines.push({
      ok: true,
      label: `${lane.label} language`,
      detail: `${audio} audio · ${subtitle} subtitles`,
    });
  }
  lines.push({
    ok: prefs.downloadsEnabled,
    label: prefs.downloadsEnabled ? "Downloads on" : "Downloads off",
    detail: prefs.downloadsEnabled ? prefs.downloadQuality : "stream-only · change in /settings",
  });
  const skips = [prefs.skipIntro ? "intros" : null, prefs.skipCredits ? "credits" : null].filter(
    Boolean,
  );
  lines.push({
    ok: skips.length > 0,
    label: skips.length > 0 ? "Auto-skip" : "Auto-skip off",
    detail: skips.length > 0 ? skips.join(" and ") : "nothing skipped",
  });
  lines.push({
    ok: prefs.autoNext,
    label: prefs.autoNext ? "Autoplay on" : "Autoplay off",
    detail: prefs.autoNext ? "next episode rolls on" : "stops after each episode",
  });
  if (prefs.analyticsChoice !== "unchanged") {
    lines.push({
      ok: prefs.analyticsChoice === "enabled",
      label: prefs.analyticsChoice === "enabled" ? "Usage ping on" : "Usage ping off",
      detail: "change any time in /settings",
    });
  }
  // Accounts are linked after the wizard commits, so they are reported as
  // pending rather than done — saying "connected" before the browser has even
  // opened would be the kind of small lie that erodes the rest.
  if (prefs.connectAniList) {
    lines.push({
      ok: false,
      label: "AniList",
      detail: "opens after setup — your browser finishes the link",
    });
  }
  if (prefs.connectTmdb) {
    lines.push({
      ok: false,
      label: "TMDB",
      detail: "opens after setup — your browser finishes the link",
    });
  }
  if (prefs.presenceDiscord) {
    lines.push({
      ok: false,
      label: "Discord presence",
      detail: "connects when Discord is running",
    });
  }
  return lines;
}

function outstandingLines(rows: readonly ScopedDependencyRow[]): readonly SummaryLine[] {
  return rows
    .filter((row) => row.state !== "ok" && row.fix !== null)
    .map((row) => ({ ok: false, label: row.name, detail: row.detail }));
}

// ─── F1 capture harness ───────────────────────────────────────────────────────

export { DependencyScreen, DoneScreen, ModeScreen } from "./setup/SetupScreens";
export { AnalyticsScreen } from "./setup/AnalyticsScreen";

// ─── Public API ───────────────────────────────────────────────────────────────

/** What the wizard hands its caller, wherever it ends. */
export type SetupFlowPayload = {
  outcome: SetupFlowResult;
  prefs: SetupPrefs;
  /**
   * How deep the user got before finishing or leaving. An abort at 0 means
   * setup was offered and declined untouched — the caller must not treat that
   * as onboarding (#230).
   */
  answeredScreens: number;
};

export function runSetupFlow(
  snapshot: CapabilitySnapshot,
  options: {
    readonly onRecheck?: () => Promise<CapabilitySnapshot>;
    readonly downloadPath?: string;
    /** Current configuration to hydrate the controls from. See #228. */
    readonly initial?: SetupInitialState;
  } = {},
): {
  result: Promise<SetupFlowPayload>;
} {
  const mounted = mountRootContent<SetupFlowPayload>({
    kind: "picker",
    renderContent: (finish) => (
      <SetupShell
        snapshot={snapshot}
        finish={(outcome, prefs, answeredScreens) => finish({ outcome, prefs, answeredScreens })}
        {...(options.onRecheck ? { onRecheck: options.onRecheck } : {})}
        {...(options.downloadPath ? { downloadPath: options.downloadPath } : {})}
        {...(options.initial ? { initial: options.initial } : {})}
      />
    ),
    // Ink teardown settles here. That is not a user decision, so it must not
    // write settings — `aborted` with zero answers leaves both the existing
    // config and the onboarding gate alone.
    fallbackValue: {
      outcome: "aborted",
      prefs: {
        ...FACTORY_INITIAL_STATE,
        connectAniList: FACTORY_INITIAL_STATE.anilistSync,
        connectTmdb: FACTORY_INITIAL_STATE.tmdbSync,
        analyticsChoice: "unchanged",
      },
      answeredScreens: 0,
    },
  });

  return { result: mounted.result };
}
