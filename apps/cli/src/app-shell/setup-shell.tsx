// Setup, in two framed screens on a first run and six on request
//
// First launch asks what you watch and whether to share usage. `/setup` and
// `kunai --setup` start the full flow. `m` joins it at Language.
//
// Skip contract: `s` takes this step's
// recommendation, `S` takes every remaining one. `esc`/`q` discard and quit —
// but only once nothing is decided yet; past screen one they ask first.
//
import {
  AUDIO_PREFERENCE_OPTIONS,
  RECOMMENDED_AUDIO_PREFERENCE,
  RECOMMENDED_SUBTITLE_PREFERENCE,
  SUBTITLE_PREFERENCE_OPTIONS,
} from "@/domain/media/media-preferences";
import type { AnalyticsPayload } from "@/services/analytics/usage-analytics-service";
import type { CapabilitySnapshot } from "@/ui";
import { Box, Text, useInput } from "ink";
import React, { useMemo, useRef, useState } from "react";

import { ROOT_HORIZONTAL_PADDING } from "./layout-policy";
import { useFrameTick } from "./primitives/SakuraPetal";
import { mountRootContent, useRootInterruptCapture } from "./root-content-state";
import { AnalyticsScreen, CONSENT_CHOICES, moveConsentCursor } from "./setup/AnalyticsScreen";
import { buildDependencyRows, type ScopedDependencyRow } from "./setup/dependency-rows";
import {
  DOWNLOAD_QUALITY_RECOMMENDED,
  FACTORY_INITIAL_STATE,
  MODE_RECOMMENDED,
  recommendedLanguageProfiles,
  SETUP_LANGUAGE_LANES,
  SETUP_SCREEN_CONTEXT,
  SETUP_SCREENS,
  cycleSetupLanguageLane,
  type SetupFlow,
  type SetupFlowResult,
  type SetupInitialState,
  type SetupLanguageLane,
  type SetupPrefs,
} from "./setup/setup-model";
import { buildFooter, describeChoice, outstandingLines, summaryLines } from "./setup/setup-summary";
import { buildSetupVerdict, setupDensity } from "./setup/setup-verdict";
import { SetupFrame, setupContentWidth } from "./setup/SetupFrame";
import { SetupPointerContext, type SetupPointerActions } from "./setup/SetupPointer";
import {
  DependencyScreen,
  DOWNLOAD_QUALITIES,
  DoneScreen,
  LanguageScreen,
  LibraryScreen,
  MODE_OPTIONS,
  ModeScreen,
} from "./setup/SetupScreens";
import { MACHINE_FOOTER, MACHINE_INTRO, StartScreen, startFooter } from "./setup/StartScreen";
import { ViewportResizeGate } from "./shell-primitives";
import { palette } from "./shell-theme";
import { useDebouncedViewportPolicy, useShellDimensions } from "./use-viewport-policy";

export {
  FACTORY_INITIAL_STATE,
  SETUP_LANGUAGE_LANES,
  cycleSetupLanguageLane,
  type SetupFlow,
  type SetupFlowResult,
  type SetupInitialState,
  type SetupLanguageLane,
  type SetupLanguageProfile,
  type SetupLanguageProfiles,
  type SetupPrefs,
} from "./setup/setup-model";

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

export function SetupShell({
  snapshot: initialSnapshot,
  finish,
  onRecheck,
  downloadPath = "your data directory",
  initial = FACTORY_INITIAL_STATE,
  analyticsPayload,
  flow: initialFlow = "full",
  playerName,
}: {
  snapshot: CapabilitySnapshot;
  analyticsPayload: AnalyticsPayload;
  finish: (
    result: SetupFlowResult,
    prefs: SetupPrefs,
    answeredScreens: number,
    flow: SetupFlow,
  ) => void;
  /** Re-probe the machine. Absent in tests that do not exercise `[r]`. */
  onRecheck?: () => Promise<CapabilitySnapshot>;
  downloadPath?: string;
  /** Current configuration, hydrated into every control. See #228. */
  initial?: SetupInitialState;
  /** `quick` on a first launch; `full` when setup was asked for. */
  flow?: SetupFlow;
  /** The player this session drives, when it is not mpv. */
  playerName?: string | undefined;
}) {
  // Columns only. The frame takes its height from its container via flexGrow —
  // sizing to `stdout.rows` is what pushed the footer off the bottom of the
  // screen, because setup mounts inside the app shell's box, not the terminal.
  const { cols, rows } = useShellDimensions();
  // Setup is inside AppRoot, whose side padding also consumes columns.
  const frameWidth = Math.max(0, cols - ROOT_HORIZONTAL_PADDING * 2);
  // Same policy the gate below renders against. While it is too small the
  // screens are not visible, so keystrokes must not steer screens the user
  // cannot see.
  const viewport = useDebouncedViewportPolicy("picker");

  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [rechecking, setRechecking] = useState(false);
  const [flow, setFlow] = useState<SetupFlow>(initialFlow);
  const order = SETUP_SCREENS[flow];
  const [screenIdx, setScreenIdx] = useState(0);
  /** `d` on the quick first screen: the full machine table, in place. */
  const [machineOpen, setMachineOpen] = useState(false);
  /** `p` at the size floor: the consent payload's values instead of its keys. */
  const [pingExpanded, setPingExpanded] = useState(false);
  const [completionOutcome, setCompletionOutcome] = useState<SetupFlowResult>("completed");
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
  const [autoNext, setAutoNext] = useState(initial.autoNext);
  const [skipIntro, setSkipIntro] = useState(initial.skipIntro);
  const [skipCredits, setSkipCredits] = useState(initial.skipCredits);
  // Rows 0..1 are downloads, 2..4 the merged-in playback toggles, 5..7 accounts.
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
  // The consent screen's cursor starts on neither row (it is neutral), and a
  // cursor is not an answer either; only `commitAnalytics` records one.
  const [analyticsIdx, setAnalyticsIdx] = useState<number | null>(null);
  /**
   * The consent screen's *committed* answer, written only by a key pressed
   * while that screen is showing.
   *
   * This used to be an `analyticsSeen` boolean flipped on arrival, with the
   * live cursor read at finish time. Arriving is not consenting: walking onto
   * the screen, pressing left to go back, and then pressing `S` elsewhere
   * finished the wizard with the cursor still parked on what was then a
   * pre-selected "turn it on" — a skip path that opted the user in, which the
   * contract in AGENTS.md forbids outright. Recording the decision instead of
   * the visit closes that whole class: nothing but a keystroke on the consent
   * screen can move this, in either direction.
   */
  const [analyticsDecision, setAnalyticsDecision] =
    useState<SetupPrefs["analyticsChoice"]>("unchanged");

  const tick = useFrameTick(rechecking, RECHECK_TICK_MS);
  const screen = order[screenIdx] ?? "analytics";
  const contentWidth = setupContentWidth(frameWidth);
  const density = setupDensity(contentWidth, rows);
  const previewOpen = screen === "analytics" && density === "tiny" && pingExpanded;
  useRootInterruptCapture(previewOpen && !viewport.tooSmall);

  const depRows: readonly ScopedDependencyRow[] = buildDependencyRows(snapshot, {
    dataDir: downloadPath,
  });

  const mode = MODE_OPTIONS[modeIdx]?.value ?? "series";
  const verdict = buildSetupVerdict({
    snapshot,
    rows: depRows,
    lane: mode,
    density,
    playerName,
  });
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

  /**
   * `decision` is the consent answer to finish with. It defaults to the
   * recorded one, and the consent screen passes what it has just committed:
   * in the quick flow that screen is the last, so finishing happens in the
   * same keystroke, before the state update is visible to this closure.
   */
  function advance(decision: SetupPrefs["analyticsChoice"] = analyticsDecision) {
    if (screenIdx < order.length - 1) {
      if (screen === "mode") setLanguageLane(languageLaneForMode(mode));
      setShowFix(false);
      setMachineOpen(false);
      setConfirmingAbort(false);
      deepestRef.current = Math.max(deepestRef.current, screenIdx + 1);
      setScreenIdx((current) => current + 1);
    } else {
      deepestRef.current = Math.max(deepestRef.current, screenIdx);
      finish(completionOutcome, buildPrefs(decision), deepestRef.current, flow);
    }
  }

  /** `m` on the quick first screen: the remaining questions, from language on. */
  function openFullSetup() {
    const languageIdx = SETUP_SCREENS.full.indexOf("language");
    setFlow("full");
    setMachineOpen(false);
    setLanguageLane(languageLaneForMode(mode));
    deepestRef.current = Math.max(deepestRef.current, languageIdx);
    setScreenIdx(languageIdx);
  }

  function back() {
    if (screenIdx > 0) {
      setShowFix(false);
      setConfirmingAbort(false);
      setScreenIdx((i) => i - 1);
    }
  }

  /**
   * Accept every remaining recommendation and show the final review.
   *
   * Analytics is excluded when the consent screen has not been reached: a
   * blanket "yes to everything" is not consent to send data. Same rule keeps
   * AniList, TMDB, and Discord off — no skip path may perform an outward-facing
   * action. The user still gets one final chance to inspect the applied values
   * before pressing Enter to save.
   */
  function acceptRemainingDefaults() {
    const prefs = buildPrefs(analyticsDecision);
    const remaining = new Set(order.slice(screenIdx));
    const nextPrefs: SetupPrefs = {
      ...prefs,
      ...(remaining.has("mode") ? { mode: MODE_RECOMMENDED } : {}),
      ...(remaining.has("language") ? { languageProfiles: recommendedLanguageProfiles() } : {}),
      // The playback toggles live on the merged library screen — "remaining"
      // for that screen now means its playback recommendations too.
      ...(remaining.has("library")
        ? {
            autoNext: true,
            skipIntro: true,
            skipCredits: true,
            downloadQuality: DOWNLOAD_QUALITY_RECOMMENDED,
          }
        : {}),
    };

    setModeIdx(
      indexOfValue(
        MODE_OPTIONS.map((option) => option.value),
        nextPrefs.mode,
      ),
    );
    setLanguageProfiles(nextPrefs.languageProfiles);
    setAutoNext(nextPrefs.autoNext);
    setSkipIntro(nextPrefs.skipIntro);
    setSkipCredits(nextPrefs.skipCredits);
    setDownloadsEnabled(nextPrefs.downloadsEnabled);
    setQualityIdx(indexOfValue(DOWNLOAD_QUALITIES, nextPrefs.downloadQuality));
    setConnectAniList(nextPrefs.connectAniList);
    setConnectTmdb(nextPrefs.connectTmdb);
    setPresenceDiscord(nextPrefs.presenceDiscord);
    setShowFix(false);
    setConfirmingAbort(false);
    setCompletionOutcome("defaults");
    deepestRef.current = Math.max(deepestRef.current, order.length - 1);
    setScreenIdx(order.length - 1);
  }

  function abort() {
    finish("aborted", buildPrefs("unchanged"), deepestRef.current, flow);
  }

  /**
   * Record the consent screen's answer. The only writer of `analyticsDecision`,
   * and it is only ever called from a key handler that has already established
   * the consent screen is the one showing — that narrowness is the guarantee.
   * The cursor follows the decision so the screen and the record agree if the
   * user steps back onto it.
   */
  function commitAnalytics(choice: "enabled" | "disabled") {
    setAnalyticsIdx(CONSENT_CHOICES.indexOf(choice));
    setAnalyticsDecision(choice);
  }

  /**
   * Leaving is free before anything is decided; afterwards it costs a confirm,
   * because one stray esc late in the flow must not throw away the earlier
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
      case "start":
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
      case "library":
        // Playback toggles merged in from the old standalone screen get the
        // on-recommendation; downloads, account links, and presence are
        // standing decisions: "recommended" for those is whatever the user
        // already has, which is what hydration loaded. Quality resets too.
        setAutoNext(true);
        setSkipIntro(true);
        setSkipCredits(true);
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

  const showingMachine = screen === "deps" || machineOpen;

  function move(delta: number) {
    const clamp = (value: number, max: number) => Math.min(Math.max(0, value), max);
    if (showingMachine) setDepIdx((i) => clamp(i + delta, depRows.length - 1));
    else if (screen === "mode" || screen === "start")
      setModeIdx((i) => clamp(i + delta, MODE_OPTIONS.length - 1));
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
    } else if (screen === "library") setLibraryIdx((i) => clamp(i + delta, 7));
    else if (screen === "analytics") setAnalyticsIdx((i) => moveConsentCursor(i, delta));
  }

  function applyLanguageProfileToAll() {
    const selected = languageProfiles[languageLane];
    setLanguageProfiles({
      series: { ...selected },
      movie: { ...selected },
      anime: { ...selected },
      youtube: { ...selected },
    });
  }

  function toggle() {
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
      if (libraryIdx === 2) setAutoNext((v) => !v);
      else if (libraryIdx === 3) setSkipIntro((v) => !v);
      else if (libraryIdx === 4) setSkipCredits((v) => !v);
      else if (libraryIdx === 5) setConnectAniList((v) => !v);
      else if (libraryIdx === 6) setConnectTmdb((v) => !v);
      else setPresenceDiscord((v) => !v);
    }
  }

  useInput((input, key) => {
    // Below the viewport minimum the screens are not rendered; keys would steer
    // decisions the user cannot see.
    if (viewport.tooSmall) return;

    // The expanded payload owns the whole surface, including quit and skip.
    if (previewOpen) return setPingExpanded(false);

    // Abort is a two-keystroke decision once anything has been answered. The
    // confirming keypress is consumed: whatever it was, it does not also act.
    if (confirmingAbort) {
      if (key.escape || input === "q" || input === "Q") abort();
      else setConfirmingAbort(false);
      return;
    }

    // The machine table is a view inside screen one: leaving it is not
    // leaving setup, and no other key acts on the lanes behind it.
    if (machineOpen) {
      if (key.upArrow) move(-1);
      else if (key.downArrow) move(1);
      else if (input === "r" || input === "R") recheck();
      else if (input !== " " && !key.tab) setMachineOpen(false);
      return;
    }

    if (key.escape || input === "q" || input === "Q") {
      requestAbort();
      return;
    }

    // `S` — accept every remaining recommendation and open the final review.
    // The consent screen has no default to accept, so it stays put and
    // chooses nothing: a keystroke aimed at everything else answers neither.
    // The quick flow has nothing left to accept, so there it only moves on.
    if (input === "S") {
      if (screen === "start") advance();
      else if (screen !== "analytics") acceptRemainingDefaults();
      return;
    }

    // `s` — take this step's recommendation and move on. It no longer ends the
    // wizard: waving past one question should not cost you the rest of setup.
    // The consent screen recommends nothing, so there `s` is its labelled
    // "don't share" key: an explicit answer, and never an opt-in.
    if (input === "s") {
      if (screen === "analytics") {
        commitAnalytics("disabled");
        advance("disabled");
      } else {
        applyScreenRecommendation();
        advance();
      }
      return;
    }

    if (screen === "start") {
      if (input === "r" || input === "R") return recheck();
      if (input === "d" || input === "D") return setMachineOpen(true);
      if (input === "m" || input === "M") return openFullSetup();
    }
    if (screen === "analytics" && density === "tiny" && (input === "p" || input === "P"))
      return setPingExpanded(true);

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
      // "enabled", and it says whatever the cursor is on; with none, it waits.
      if (screen === "analytics") {
        if (analyticsIdx === null) return;
        const choice = CONSENT_CHOICES[analyticsIdx] ?? "disabled";
        commitAnalytics(choice);
        advance(choice);
        return;
      }
      advance();
      return;
    }

    if (screen === "language") {
      if (key.tab) {
        setLanguageLane((current) => cycleSetupLanguageLane(current, key.shift ? -1 : 1));
        return;
      }
      if (key.leftArrow) {
        setLangFocus("audio");
        return;
      }
      if (key.rightArrow) {
        setLangFocus("subtitle");
        return;
      }
      if (input === "a" || input === "A") {
        applyLanguageProfileToAll();
        return;
      }
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

  const pointerRef = useRef<SetupPointerActions | null>(null);
  const pointer = useMemo<SetupPointerActions>(
    () => ({
      pick: (field, value) => pointerRef.current?.pick(field, value),
      action: (key) => pointerRef.current?.action(key),
    }),
    [],
  );
  const latestPointer: SetupPointerActions = {
    pick(field, value) {
      if (viewport.tooSmall || rechecking) return;
      if (confirmingAbort) {
        setConfirmingAbort(false);
        return;
      }
      if (field === "lane") {
        const lane = SETUP_LANGUAGE_LANES.find((entry) => entry.value === value);
        if (lane) setLanguageLane(lane.value);
        return;
      }
      const index = Number(value);
      if (!Number.isInteger(index) || index < 0) return;
      if (field === "mode" && index < MODE_OPTIONS.length) setModeIdx(index);
      if (field === "library" && index < 8) {
        if (libraryIdx === index) toggle();
        else setLibraryIdx(index);
      }
      if (field === "audio" || field === "subtitle") {
        const options = field === "audio" ? AUDIO_PREFERENCE_OPTIONS : SUBTITLE_PREFERENCE_OPTIONS;
        const option = options[index];
        if (!option) return;
        setLangFocus(field);
        setLanguageProfiles((current) => ({
          ...current,
          [languageLane]: { ...current[languageLane], [field]: option.value },
        }));
      }
    },
    action(key) {
      if (viewport.tooSmall || rechecking) return;
      if (confirmingAbort) {
        setConfirmingAbort(false);
        return;
      }
      if (machineOpen) {
        if (key === "r") recheck();
        else if (key === "d") setMachineOpen(false);
        return;
      }
      if (previewOpen) return setPingExpanded(false);
      if (key === "enter") {
        // A pointer can never grant the keystroke-only analytics consent.
        if (screen !== "analytics") advance();
      } else if (key === "b") back();
      else if (key === "s") {
        if (screen === "analytics") {
          commitAnalytics("disabled");
          advance("disabled");
        } else {
          applyScreenRecommendation();
          advance();
        }
      } else if (key === "m") {
        if (screen === "start") openFullSetup();
      } else if (key === "S") {
        if (screen !== "analytics") acceptRemainingDefaults();
      } else if (key === "a") applyLanguageProfileToAll();
      else if (key === "tab") setLanguageLane((current) => cycleSetupLanguageLane(current, 1));
      else if (key === "←→")
        setLangFocus((current) => (current === "audio" ? "subtitle" : "audio"));
      else if (key === "space") toggle();
      else if (key === "r") recheck();
      else if (key === "d") {
        if (screen === "start") setMachineOpen(true);
        else setShowFix((current) => !current);
      }
    },
  };

  const footer =
    screen === "start"
      ? machineOpen
        ? MACHINE_FOOTER
        : startFooter({ attention: verdict.attention, density })
      : previewOpen
        ? [{ key: "any key", label: "back" }]
        : buildFooter(screen, {
            hasFix: Boolean(depRows[depIdx]?.fix),
            isFirst: screenIdx === 0,
          });

  // The handlers close over this render's state, so the latest set is kept in
  // a ref and the context gets one stable object that delegates to it: click
  // targets do not re-render just because setup did.
  pointerRef.current = latestPointer;

  return (
    <SetupPointerContext.Provider value={pointer}>
      <ViewportResizeGate kind="picker" message="Resize terminal to run setup">
        <SetupFrame
          width={frameWidth}
          context={machineOpen ? "this machine" : SETUP_SCREEN_CONTEXT[screen]}
          step={screenIdx}
          totalSteps={order.length}
          footer={footer}
          dense={density === "tiny"}
          // The summary screen draws its own, in a pose that means the waiting is
          // over. The frame would otherwise stack a second one above it. She
          // also yields her rows wherever the decision needs them.
          companion={
            screen === "deps" || (screen === "start" && density === "wide" && !machineOpen)
              ? "setup"
              : null
          }
        >
          {showingMachine ? (
            <DependencyScreen
              rows={depRows}
              selected={depIdx}
              rechecking={rechecking}
              tick={tick}
              showFix={showFix || machineOpen}
              contentWidth={contentWidth}
              {...(machineOpen ? { heading: "This machine", intro: MACHINE_INTRO[density] } : {})}
            />
          ) : null}
          {screen === "start" && !machineOpen ? (
            <StartScreen
              selected={modeIdx}
              verdict={verdict}
              rechecking={rechecking}
              tick={tick}
              density={density}
            />
          ) : null}
          {screen === "mode" ? <ModeScreen selected={modeIdx} /> : null}
          {screen === "language" ? (
            <LanguageScreen
              lanes={SETUP_LANGUAGE_LANES}
              activeLane={languageLane}
              contentWidth={contentWidth}
              audioOptions={AUDIO_PREFERENCE_OPTIONS}
              subtitleOptions={SUBTITLE_PREFERENCE_OPTIONS}
              audioIndex={audioIdx}
              subtitleIndex={subtitleIdx}
              focus={langFocus}
            />
          ) : null}
          {screen === "library" ? (
            <LibraryScreen
              toggles={{
                downloadsEnabled,
                downloadQuality: DOWNLOAD_QUALITIES[qualityIdx] ?? "1080p",
                autoNext,
                skipIntro,
                skipCredits,
                connectAniList,
                connectTmdb,
                presenceDiscord,
              }}
              selected={libraryIdx}
              ytDlpReady={snapshot.ytDlp}
              downloadPath={downloadPath}
            />
          ) : null}
          {screen === "analytics" ? (
            <AnalyticsScreen
              selectedIndex={analyticsIdx}
              payload={analyticsPayload}
              density={density}
              contentWidth={contentWidth}
              expanded={previewOpen}
            />
          ) : null}
          {screen === "done" ? (
            <DoneScreen
              compact={rows < 30}
              contentWidth={contentWidth}
              headline={describeChoice(buildPrefs(analyticsDecision))}
              summary={summaryLines(buildPrefs(analyticsDecision))}
              outstanding={outstandingLines(depRows)}
            />
          ) : null}

          {confirmingAbort ? (
            <Box marginTop={1}>
              <Text color={palette.dangerText} bold>
                Press esc again to quit without saving
              </Text>
              <Text color={palette.muted}> — any other key stays.</Text>
            </Box>
          ) : null}
        </SetupFrame>
      </ViewportResizeGate>
    </SetupPointerContext.Provider>
  );
}

// ─── F1 capture harness ───────────────────────────────────────────────────────

export { DependencyScreen, DoneScreen, ModeScreen } from "./setup/SetupScreens";
export { AnalyticsScreen } from "./setup/AnalyticsScreen";

// ─── Public API ───────────────────────────────────────────────────────────────

/** What the wizard hands its caller, wherever it ends. */
export type SetupFlowPayload = {
  flow: SetupFlow;
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
    readonly analyticsPayload: AnalyticsPayload;
    readonly flow?: SetupFlow | undefined;
    readonly playerName?: string | undefined;
  },
): { result: Promise<SetupFlowPayload> } {
  const mounted = mountRootContent<SetupFlowPayload>({
    kind: "picker",
    headerLabel: "Setup",
    ownsMachineVerdict: true,
    renderContent: (finish) => (
      <SetupShell
        snapshot={snapshot}
        finish={(outcome, prefs, answeredScreens, flow) =>
          finish({ outcome, prefs, answeredScreens, flow })
        }
        {...(options.onRecheck ? { onRecheck: options.onRecheck } : {})}
        {...(options.downloadPath ? { downloadPath: options.downloadPath } : {})}
        {...(options.initial ? { initial: options.initial } : {})}
        flow={options.flow ?? "full"}
        playerName={options.playerName}
        analyticsPayload={options.analyticsPayload}
      />
    ),
    // Ink teardown records no answers and leaves the onboarding gate open.
    fallbackValue: {
      flow: options.flow ?? "full",
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
