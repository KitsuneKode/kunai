// =============================================================================
// setup-shell.tsx — first run, in seven framed screens
//
// Every screen asks something or pays something off, and every one of them
// wears the Sakura shell frame. Setup used to be the only surface in Kunai
// without it, which is why it read as a different application.
//
// Layout and grammar: `.reference/design/cli/kunai-sakura-systems.html` and
// `01-shell-footer-contract.md`. Skip contract: `s` takes this step's
// recommendation, `S` takes every remaining one, `esc` aborts without writing.
// =============================================================================

import {
  AUDIO_PREFERENCE_OPTIONS,
  RECOMMENDED_AUDIO_PREFERENCE,
  RECOMMENDED_SUBTITLE_PREFERENCE,
  SUBTITLE_PREFERENCE_OPTIONS,
} from "@/domain/media/media-preferences";
import type { CapabilitySnapshot } from "@/ui";
import { Box, useInput } from "ink";
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
import { useShellDimensions } from "./use-viewport-policy";

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

export interface SetupPrefs {
  mode: "series" | "anime" | "youtube";
  audio: string;
  subtitle: string;
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
}: {
  snapshot: CapabilitySnapshot;
  finish: (result: SetupFlowResult, prefs: SetupPrefs) => void;
  /** Re-probe the machine. Absent in tests that do not exercise `[r]`. */
  onRecheck?: () => Promise<CapabilitySnapshot>;
  downloadPath?: string;
}) {
  // Columns only. The frame takes its height from its container via flexGrow —
  // sizing to `stdout.rows` is what pushed the footer off the bottom of the
  // screen, because setup mounts inside the app shell's box, not the terminal.
  const { cols } = useShellDimensions();

  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [rechecking, setRechecking] = useState(false);
  const [screenIdx, setScreenIdx] = useState(0);

  const [depIdx, setDepIdx] = useState(0);
  const [showFix, setShowFix] = useState(false);
  const [modeIdx, setModeIdx] = useState(0);
  const [audioIdx, setAudioIdx] = useState(() =>
    recommendedIndex(AUDIO_PREFERENCE_OPTIONS, RECOMMENDED_AUDIO_PREFERENCE),
  );
  const [subtitleIdx, setSubtitleIdx] = useState(() =>
    recommendedIndex(SUBTITLE_PREFERENCE_OPTIONS, RECOMMENDED_SUBTITLE_PREFERENCE),
  );
  const [langFocus, setLangFocus] = useState<"audio" | "subtitle">("audio");
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [autoNext, setAutoNext] = useState(true);
  const [skipIntro, setSkipIntro] = useState(true);
  const [skipCredits, setSkipCredits] = useState(true);
  const [libraryIdx, setLibraryIdx] = useState(0);
  // Downloads follow what is installed. Defaulting to on where yt-dlp is absent
  // pre-selected the one option that cannot work.
  const [downloadsEnabled, setDownloadsEnabled] = useState(snapshot.ytDlp);
  const [qualityIdx, setQualityIdx] = useState(0);
  const [connectAniList, setConnectAniList] = useState(false);
  const [connectTmdb, setConnectTmdb] = useState(false);
  const [presenceDiscord, setPresenceDiscord] = useState(false);
  // Index 0 is "turn it on" — the recommendation. Only ever committed by a
  // keystroke on that screen: `s` selects off, and accept-all stops there.
  const [analyticsIdx, setAnalyticsIdx] = useState(ANALYTICS_ON_INDEX);
  const [analyticsSeen, setAnalyticsSeen] = useState(false);

  const tick = useFrameTick(rechecking, RECHECK_TICK_MS);
  const screen = SCREEN_ORDER[screenIdx] as Screen;

  const depRows: readonly ScopedDependencyRow[] = buildDependencyRows(snapshot, {
    dataDir: downloadPath,
  });

  const mode = MODE_OPTIONS[modeIdx]?.value ?? "series";

  function buildPrefs(consented: boolean): SetupPrefs {
    return {
      mode,
      audio: AUDIO_PREFERENCE_OPTIONS[audioIdx]?.value ?? RECOMMENDED_AUDIO_PREFERENCE,
      subtitle: SUBTITLE_PREFERENCE_OPTIONS[subtitleIdx]?.value ?? RECOMMENDED_SUBTITLE_PREFERENCE,
      autoNext,
      skipIntro,
      skipCredits,
      downloadsEnabled,
      downloadQuality: DOWNLOAD_QUALITIES[qualityIdx] ?? "1080p",
      connectAniList,
      connectTmdb,
      presenceDiscord,
      analyticsChoice: !consented
        ? "unchanged"
        : analyticsIdx === ANALYTICS_ON_INDEX
          ? "enabled"
          : "disabled",
    };
  }

  function advance() {
    if (screenIdx < SCREEN_ORDER.length - 1) {
      const next = SCREEN_ORDER[screenIdx + 1];
      if (next === "analytics") setAnalyticsSeen(true);
      setShowFix(false);
      setScreenIdx((current) => current + 1);
    } else {
      finish("completed", buildPrefs(analyticsSeen));
    }
  }

  function back() {
    if (screenIdx > 0) {
      setShowFix(false);
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
    finish("defaults", buildPrefs(analyticsSeen));
  }

  function abort() {
    finish("aborted", buildPrefs(false));
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
        setAudioIdx((i) => clamp(i + delta, AUDIO_PREFERENCE_OPTIONS.length - 1));
      } else {
        setSubtitleIdx((i) => clamp(i + delta, SUBTITLE_PREFERENCE_OPTIONS.length - 1));
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
      if (libraryIdx === 0) setDownloadsEnabled((v) => !v);
      else if (libraryIdx === 1) setQualityIdx((i) => (i + 1) % DOWNLOAD_QUALITIES.length);
      else if (libraryIdx === 2) setConnectAniList((v) => !v);
      else if (libraryIdx === 3) setConnectTmdb((v) => !v);
      else setPresenceDiscord((v) => !v);
    }
  }

  useInput((input, key) => {
    if (key.escape) {
      abort();
      return;
    }

    // `S` — accept every remaining recommendation and finish. On the consent
    // screen it advances instead of passing through, so analytics is never
    // enabled by a keystroke aimed at everything else.
    if (input === "S") {
      if (screen === "analytics") {
        setAnalyticsIdx(ANALYTICS_OFF_INDEX);
        advance();
        return;
      }
      acceptRemainingDefaults();
      return;
    }

    // `s` — take this step's recommendation and move on. It no longer ends the
    // wizard: waving past one question should not cost you the rest of setup.
    if (input === "s") {
      if (screen === "analytics") setAnalyticsIdx(ANALYTICS_OFF_INDEX);
      advance();
      return;
    }

    if (input === "q" || input === "Q") {
      abort();
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
      advance();
      return;
    }

    if (key.tab && screen === "language") {
      setLangFocus((f) => (f === "audio" ? "subtitle" : "audio"));
      return;
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
            headline={describeChoice(buildPrefs(analyticsSeen))}
            summary={summaryLines(buildPrefs(analyticsSeen))}
            outstanding={outstandingLines(depRows)}
          />
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
        { key: "s", label: "use recommended" },
      ];
    case "language":
      return [
        { key: "enter", label: "confirm" },
        { key: "↑↓", label: "choose" },
        { key: "tab", label: "audio / subs" },
        ...back,
      ];
    case "playback":
    case "library":
      return [
        { key: "space", label: "toggle" },
        { key: "↑↓", label: "choose" },
        { key: "enter", label: "next" },
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
  const audio =
    AUDIO_PREFERENCE_OPTIONS.find((option) => option.value === prefs.audio)?.label ?? prefs.audio;
  const subtitle =
    SUBTITLE_PREFERENCE_OPTIONS.find((option) => option.value === prefs.subtitle)?.label ??
    prefs.subtitle;
  return `${modeLabel} · ${audio} audio · ${subtitle} subtitles`;
}

function summaryLines(prefs: SetupPrefs): readonly SummaryLine[] {
  const lines: SummaryLine[] = [];
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
    lines.push({ ok: false, label: "AniList", detail: "opening your browser to finish linking…" });
  }
  if (prefs.connectTmdb) {
    lines.push({ ok: false, label: "TMDB", detail: "opening your browser to finish linking…" });
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

export function runSetupFlow(
  snapshot: CapabilitySnapshot,
  options: {
    readonly onRecheck?: () => Promise<CapabilitySnapshot>;
    readonly downloadPath?: string;
  } = {},
): {
  result: Promise<{ outcome: SetupFlowResult; prefs: SetupPrefs }>;
} {
  const mounted = mountRootContent<{ outcome: SetupFlowResult; prefs: SetupPrefs }>({
    kind: "picker",
    renderContent: (finish) => (
      <SetupShell
        snapshot={snapshot}
        finish={(outcome, prefs) => finish({ outcome, prefs })}
        {...(options.onRecheck ? { onRecheck: options.onRecheck } : {})}
        {...(options.downloadPath ? { downloadPath: options.downloadPath } : {})}
      />
    ),
    // Ink teardown settles here. That is not a user decision, so it must not
    // write settings — `aborted` leaves the existing config alone.
    fallbackValue: {
      outcome: "aborted",
      prefs: {
        mode: "series",
        audio: RECOMMENDED_AUDIO_PREFERENCE,
        subtitle: RECOMMENDED_SUBTITLE_PREFERENCE,
        autoNext: true,
        skipIntro: true,
        skipCredits: true,
        downloadsEnabled: false,
        downloadQuality: "1080p",
        connectAniList: false,
        connectTmdb: false,
        presenceDiscord: false,
        analyticsChoice: "unchanged",
      },
    },
  });

  return { result: mounted.result };
}

/** Unused Box import guard — the frame owns layout now. */
void Box;
