import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { AnalyticsDisclosureBanner } from "@/app-shell/AnalyticsDisclosureBanner";
import { CalendarDayStrip, CalendarScheduleRow, CalendarTypeTabs } from "@/app-shell/calendar-ui";
import { CapabilityIssueStrip } from "@/app-shell/CapabilityIssueStrip";
import { companionMode, companionToggleable } from "@/app-shell/companion-policy";
import { DetailsSheetUI, TitleDetailSheetUI } from "@/app-shell/details-pane-ui";
import { DetailsSheet } from "@/app-shell/details-sheet-ui";
import {
  buildDiagnosticsPanelModel,
  flattenDiagnosticsPanelSpans,
} from "@/app-shell/diagnostics-panel.model";
import {
  DownloadManagerContent,
  downloadQueueStatusLabel,
} from "@/app-shell/download-manager-shell";
import { ExitShell } from "@/app-shell/exit-shell";
import { compactProgressBar } from "@/app-shell/format/bar";
import { GuideShell } from "@/app-shell/guide-shell";
import { LibraryShell, libraryResumeCardCopy } from "@/app-shell/library-shell";
import { LoadingShell } from "@/app-shell/loading-shell";
import { MediaPanel } from "@/app-shell/MediaPanel";
import { reducedMotionEnabled } from "@/app-shell/motion-policy";
import { OverlayLayoutProvider } from "@/app-shell/overlay-layout-context";
import { OverlayPanel } from "@/app-shell/overlay-panel";
import { plainModeEnabled, setPlainModePreferenceSource } from "@/app-shell/plain-mode";
import { PostPlayShell } from "@/app-shell/post-play-shell";
import { ActionList } from "@/app-shell/primitives/ActionList";
import { AppHeader } from "@/app-shell/primitives/AppHeader";
import { ClaudeTabRow } from "@/app-shell/primitives/ClaudeTabRow";
import { ListRow } from "@/app-shell/primitives/ListRow";
import { listRowTitleColumn } from "@/app-shell/primitives/ListRow.model";
import { LoadingState } from "@/app-shell/primitives/LoadingState";
import { MediaListShell } from "@/app-shell/primitives/MediaListShell";
import { ProgressBar } from "@/app-shell/primitives/ProgressBar";
import { ResumeCard } from "@/app-shell/primitives/ResumeCard";
import { SectionGroup } from "@/app-shell/primitives/SectionGroup";
import { SegmentedControl } from "@/app-shell/primitives/SegmentedControl";
import { StateBlock } from "@/app-shell/primitives/StateBlock";
import { BooleanSwitch } from "@/app-shell/primitives/Switch";
import { HelpShell } from "@/app-shell/root-overlay-shell";
import { ErrorShell, RootIdleShell } from "@/app-shell/root-status-shells";
import { SakuraLoader } from "@/app-shell/SakuraLoader";
import { buildSettingsPage } from "@/app-shell/settings/build-page";
import { SettingRowBoolean } from "@/app-shell/settings/components/SettingRowBoolean";
import { SettingRowSubmenu } from "@/app-shell/settings/components/SettingRowSubmenu";
import { SettingsSearchBar } from "@/app-shell/settings/components/SettingsSearchBar";
import { appearanceSettingsRows } from "@/app-shell/settings/registry/appearance";
import { SettingsOverlay } from "@/app-shell/settings/SettingsOverlay";
import { createSettingsUiState } from "@/app-shell/settings/state";
import type { SettingsRegistryContext } from "@/app-shell/settings/types";
import { ChoiceRow, SetupFrame, ToggleRow } from "@/app-shell/setup/SetupFrame";
import {
  DependencyScreen,
  DoneScreen,
  LanguageScreen,
  LibraryScreen,
  ModeScreen,
} from "@/app-shell/setup/SetupScreens";
import { CommandPalette } from "@/app-shell/shell-command-ui";
import { InputField } from "@/app-shell/shell-frame";
import { Footer } from "@/app-shell/shell-primitives";
import { SearchSuggestionBand } from "@/app-shell/suggestion-band-ui";
import { TracksPanelShell } from "@/app-shell/tracks-panel-shell";
import type { Container } from "@/container";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import { createInitialState } from "@/domain/session/SessionState";
import { emptyMpvHardwareAccelProbe } from "@/infra/player/mpv-hwaccel-probe";
import { buildHelpText, parseArgs } from "@/main";
import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import type { DownloadJobRecord, HistoryProgress } from "@/services/storage/storage-read-models";
import { SHIPPED_ANILIST_REDIRECT_URI } from "@/services/sync/auth-contract";
import type { CapabilitySnapshot } from "@/ui";
import { DEFAULT_CONFIG } from "@kunai/config";
import { Box, Text } from "ink";
import { act } from "react";

import { captureFrame, render, stripAnsi } from "../../harness/render-capture";
import { readRepoFile } from "../../support/repo-scan";

/** Box-drawing lines and decorative glyphs that screen readers announce as noise. */
const DECORATIVE_NOISE = /[┌┐└┘─│╭╮╰╯🦊❀✿❁✾▌█┈░▰▱◉○●◆◈▲▼]/u;

/** Glyphs that must not survive a plain-mode render of a root shell. */
const PLAIN_MODE_GLYPHS = /[─│┌┐└┘╭╮╰╯▌▸▶▼▲●○✓✗↓★♥❀⚠△⚲‹›⇥]/u;

let savedPlain: string | undefined;

function enablePlainMode(): void {
  process.env.KUNAI_PLAIN = "1";
}

beforeEach(() => {
  savedPlain = process.env.KUNAI_PLAIN;
});

afterEach(() => {
  setPlainModePreferenceSource(() => false);
  if (savedPlain === undefined) delete process.env.KUNAI_PLAIN;
  else process.env.KUNAI_PLAIN = savedPlain;
});

describe("plain mode policy, flag, env, and setting", () => {
  test("precedence: KUNAI_PLAIN overrides stored preference; unset falls back to preference", () => {
    setPlainModePreferenceSource(() => false);
    expect(plainModeEnabled({})).toBe(false);
    expect(plainModeEnabled({ KUNAI_PLAIN: "1" })).toBe(true);
    expect(plainModeEnabled({ KUNAI_PLAIN: "true" })).toBe(true);
    expect(plainModeEnabled({ KUNAI_PLAIN: "0" })).toBe(false);

    setPlainModePreferenceSource(() => true);
    expect(plainModeEnabled({})).toBe(true);
    expect(plainModeEnabled({ KUNAI_PLAIN: "" })).toBe(true);
    expect(plainModeEnabled({ KUNAI_PLAIN: "0" })).toBe(false);
    expect(plainModeEnabled({ KUNAI_PLAIN: "off" })).toBe(false);
  });

  test("plain mode disables motion and companion art/glyphs", () => {
    expect(reducedMotionEnabled({ KUNAI_PLAIN: "1" })).toBe(true);
    expect(companionMode({ KUNAI_PLAIN: "1" }, { isTTY: true })).toBe("off");
    expect(companionToggleable({ KUNAI_PLAIN: "1" }, { isTTY: true })).toBe(false);
  });

  test("the screen buffer and mouse change on the next launch", () => {
    const statement = readRepoFile("ACCESSIBILITY.md");
    expect(statement).toContain("screen buffer");
    expect(statement).toContain("mouse reporting");
    expect(statement.toLowerCase()).toContain("next launch");
  });

  test("--plain parses cleanly and is documented in --help", () => {
    expect(parseArgs(["--plain"]).plain).toBe(true);
    expect(parseArgs([]).plain).toBe(false);
    expect(buildHelpText()).toContain("--plain");
  });

  test("plainMode setting exists in appearance settings and toggles both ways", () => {
    const rows = appearanceSettingsRows();
    const plainRow = rows.find((row) => row.id === "plainMode");
    expect(plainRow?.detail).toContain("screen buffer");
    expect(plainRow?.detail).toContain("mouse");
    expect(plainRow?.detail?.toLowerCase()).toContain("next launch");
    expect(plainRow?.kind).toBe("boolean");
    if (plainRow?.kind === "boolean") {
      expect(plainRow.read(DEFAULT_CONFIG)).toBe(false);
      const enabled = plainRow.write(DEFAULT_CONFIG, true);
      expect(plainRow.read(enabled)).toBe(true);
      const disabled = plainRow.write(enabled, false);
      expect(plainRow.read(disabled)).toBe(false);
    }
  });

  test("compactProgressBar outputs text percentage in plain mode", () => {
    enablePlainMode();
    expect(compactProgressBar(42)).toBe("42%");
    expect(compactProgressBar(42)).not.toMatch(DECORATIVE_NOISE);
  });
});

describe("plain / screen-reader rendering across every shell surface", () => {
  test("chrome & shared primitives: header, tabs, switches, progress, state, footer, banners", () => {
    enablePlainMode();
    const header = captureFrame(
      <AppHeader destination="Browse" context="series" status="ready" width={100} />,
      { columns: 100, rows: 10 },
    );
    const tabs = captureFrame(
      <Box flexDirection="column">
        <ClaudeTabRow labels={["General", "Sources", "Playback"]} activeIndex={1} />
        <SegmentedControl labels={["All", "Anime", "Series"]} activeIndex={0} />
        <SectionGroup label="Results" tag="3 items" />
      </Box>,
      { columns: 100, rows: 12 },
    );
    const controls = captureFrame(
      <Box flexDirection="column">
        <BooleanSwitch on />
        <BooleanSwitch on={false} />
        <ProgressBar value={65} max={100} width={20} />
        <StateBlock
          model={{ kind: "empty", title: "Nothing here yet", detail: "Try searching." }}
        />
        <LoadingState message="Fetching catalog" active />
        <SakuraLoader label="Resolving sources" sublabel="esc to cancel" active />
      </Box>,
      { columns: 100, rows: 25 },
    );
    const missingMpvSnapshot: CapabilitySnapshot = {
      mpv: false,
      mpvRequired: true,
      vlc: true,
      vlcRequired: false,
      ytDlp: true,
      ffprobe: true,
      curl: { present: true, impersonates: true, profile: "chrome" },
      image: {
        terminal: "unknown",
        protocol: "none",
        renderer: "none",
        available: false,
        reason: "test",
      },
      mpvHardwareAccel: emptyMpvHardwareAccelProbe("mpv-not-found"),
      issues: [
        {
          id: "mpv-missing",
          severity: "fatal",
          message: "mpv not found",
          remediation: ["install mpv"],
          install: { note: "install mpv" },
        },
      ],
    };
    const banners = captureFrame(
      <Box flexDirection="column">
        <AnalyticsDisclosureBanner width={80} />
        <CapabilityIssueStrip
          snapshot={missingMpvSnapshot}
          mode="series"
          downloadsEnabled={false}
          width={80}
        />
        <Footer
          taskLabel="Choose a title"
          actions={[
            { key: "enter", label: "play", primary: true },
            { key: "/", label: "commands", action: "command-mode" },
          ]}
          terminalWidth={100}
        />
      </Box>,
      { columns: 100, rows: 30 },
    );

    for (const frame of [header, tabs, controls, banners]) {
      expect(frame.length).toBeGreaterThan(0);
      expect(frame).not.toMatch(DECORATIVE_NOISE);
    }
    expect(header).toContain("Kunai | Browse | series | Status: ready");
    expect(tabs).toContain("[active] Sources");
    expect(tabs).toContain("[active] All");
    expect(tabs).toContain("RESULTS (3 items)");
    expect(controls).toContain("[on]");
    expect(controls).toContain("[off]");
    expect(controls).toContain("[65%]");
    expect(controls).toContain("Empty: Nothing here yet");
    expect(controls).toContain("Try searching.");
    expect(controls).toContain("Loading: Fetching catalog");
    expect(controls).toContain("Loading: Resolving sources");
    expect(banners).toContain("Notice: Anonymous usage analytics is not enabled");
    expect(banners).toContain("Warning:");
    expect(banners).toContain("Actions: [enter] play, [/] commands");
  });

  test("browse & search surfaces: list rows, stacked preview rail, suggestions, input, idle", () => {
    enablePlainMode();
    const frame = captureFrame(
      <>
        <InputField label="Search" value="Dune" onChange={() => {}} focus />
        <MediaListShell
          columns={140}
          listWidth={80}
          list={
            <>
              <ListRow
                selected
                rowWidth={80}
                columns={[listRowTitleColumn("Dune: Part Two", 40)]}
              />
              <ListRow
                selected={false}
                rowWidth={80}
                columns={[listRowTitleColumn("Blade Runner 2049", 40)]}
              />
            </>
          }
          railModel={{
            title: "Dune: Part Two",
            subtitle: "Movie · 2024",
            overview: "Paul Atreides unites with the Fremen.",
            posterState: "loading",
            facts: [{ label: "Rating", value: "8.3" }],
          }}
        />
        <SearchSuggestionBand
          width={80}
          selectedIndex={0}
          model={{
            rows: [
              { kind: "header", label: "Catalog" },
              {
                kind: "item",
                item: {
                  suggestion: {
                    id: "1",
                    title: "Dune",
                    source: "catalog",
                    meta: "2021",
                    badge: "Movie",
                  },
                  matchIndices: [0, 1, 2, 3],
                  score: 100,
                },
              },
              { kind: "skeleton", skeletonIndex: 0 },
            ],
            items: [
              {
                suggestion: {
                  id: "1",
                  title: "Dune",
                  source: "catalog",
                  meta: "2021",
                  badge: "Movie",
                },
                matchIndices: [0, 1, 2, 3],
                score: 100,
              },
            ],
          }}
        />
        <RootIdleShell
          state={createInitialState("vidlink", "allmanga", {
            anime: DEFAULT_CONFIG.animeLanguageProfile,
            series: DEFAULT_CONFIG.seriesLanguageProfile,
            movie: DEFAULT_CONFIG.movieLanguageProfile,
          })}
        />
      </>,
      { columns: 140, rows: 60 },
    );

    expect(frame).not.toMatch(DECORATIVE_NOISE);
    expect(frame).toContain("Search (focused): Dune");
    expect(frame).toContain("[selected] Dune: Part Two");
    expect(frame).toContain("Preview: Dune: Part Two");
    expect(frame).toContain("Rating: 8.3");
    expect(frame).toContain("Loading suggestions...");
    expect(frame).toContain("Welcome to Kunai");
  });

  test("details surfaces: DetailsSheet, DetailsSheetUI, and TitleDetailSheetUI", () => {
    enablePlainMode();
    const frame = captureFrame(
      <>
        <DetailsSheet
          width={80}
          seasonsExpanded={false}
          model={{
            header: { title: "Severance", metaLine: "Series · 2022", genres: ["Sci-Fi"] },
            your: { providers: ["vidlink"], subs: ["en"], offline: false },
            synopsis: { text: "", loading: true },
            facts: { loading: false, episodes: "19 eps" },
            cast: { names: ["Adam Scott"], loading: false },
            seasons: { loading: false, items: [{ season: 1, label: "Season 1" }] },
            links: { items: [] },
            trailerUrl: "https://example.test/trailer",
          }}
        />
        <DetailsSheetUI
          width={76}
          data={{
            primary: { title: "Arrival", type: "movie", year: "2016", genres: ["Sci-Fi"] },
            secondary: null,
          }}
          lines={[{ label: "Runtime", detail: "116 min" }]}
        />
        <TitleDetailSheetUI
          width={76}
          detail={{
            id: "1",
            title: "Arrival",
            type: "movie",
            year: "2016",
            synopsis: "A linguist communicates with extraterrestrials.",
          }}
        />
      </>,
      { columns: 100, rows: 60 },
    );

    expect(frame).not.toMatch(DECORATIVE_NOISE);
    expect(frame).toContain("Loading...");
    expect(frame).toContain("1 seasons (collapsed, press s to toggle)");
    expect(frame).toContain("Trailer (t)");
  });

  test("settings rows & search bar announce state and selection in words", () => {
    enablePlainMode();
    const appearanceRows = appearanceSettingsRows();
    const plainDef = appearanceRows.find((r) => r.id === "plainMode")!;
    const themeDef = appearanceRows.find((r) => r.id === "theme")!;
    const frame = captureFrame(
      <>
        <SettingsSearchBar query="theme" focused />
        <SettingRowBoolean
          row={{ def: plainDef, label: plainDef.label, valueSummary: "on" }}
          selected
          rowWidth={80}
        />
        <SettingRowSubmenu
          row={{ def: themeDef, label: themeDef.label, valueSummary: "Paper Sakura (Light)" }}
          selected={false}
          rowWidth={80}
        />
      </>,
      { columns: 100, rows: 20 },
    );

    expect(frame).not.toMatch(DECORATIVE_NOISE);
    expect(frame).toContain("Search (focused): theme");
    expect(frame).toContain("[selected] Plain / screen-reader mode: [on]");
    expect(frame).toContain("Theme: Paper Sakura (Light)");
  });

  test("playback status, MediaPanel, PostPlayShell, TracksPanelShell, and ExitShell", () => {
    enablePlainMode();
    const frame = captureFrame(
      <>
        <LoadingShell
          state={{
            title: "Andor",
            subtitle: "S01E01",
            operation: "resolving",
            stage: "preparing-provider",
            stageDetail: "Checking VidLink",
            progress: 40,
          }}
        />
        <MediaPanel
          railWidth={40}
          placementSlot="playing-rail"
          model={{
            kind: "series",
            kindBadge: "Series",
            title: "Andor",
            facts: [{ label: "Provider", value: "vidlink" }],
            miniCards: [],
            progress: { percent: 40, label: "40%" },
          }}
        />
        <PostPlayShell
          title="Andor"
          episodeLabel="S01E01"
          nextEpisodeLabel="S01E02"
          postPlayState={{ kind: "mid-series" }}
          selectedActionIndex={0}
          totalEpisodes={12}
          watchedEpisodes={3}
        />
        <TracksPanelShell
          width={120}
          height={20}
          showNavHint
          nav={{ focusedPane: "options", sectionIndex: 0, optionIndex: 0 }}
          groups={[
            {
              section: "source",
              title: "Sources",
              selectable: true,
              rows: [
                {
                  section: "source",
                  value: "src-1",
                  label: "VidLink Primary",
                  selected: true,
                  enabled: true,
                  risk: "normal",
                },
              ],
            },
          ]}
        />
        <ExitShell onDone={() => {}} />
      </>,
      { columns: 120, rows: 90 },
    );

    expect(frame).not.toMatch(DECORATIVE_NOISE);
    expect(frame).toContain("[done] Resolving");
    expect(frame).toContain("[in progress] Checking VidLink");
    expect(frame).toContain("[pending] Buffering");
    expect(frame).toContain("[40%]");
    expect(frame).toContain("[selected] VidLink Primary [active]");
    expect(frame).toContain("Kunai closed. See you next time.");
  });

  test("setup wizard, command palette, and overlays announce selection and state as text", () => {
    enablePlainMode();
    const setupFrame = captureFrame(
      <SetupFrame
        width={80}
        context="welcome"
        step={0}
        totalSteps={6}
        footer={[{ key: "enter", label: "continue" }]}
      >
        <DependencyScreen
          rows={[
            {
              id: "mpv",
              name: "mpv",
              state: "ok",
              detail: "0.38",
              role: "player",
              fix: null,
              scope: "always",
            },
            {
              id: "ytdlp",
              name: "yt-dlp",
              state: "blocking",
              detail: "missing",
              role: "downloads",
              fix: null,
              scope: "downloads",
            },
          ]}
          selected={0}
          rechecking={false}
          tick={0}
          showFix={false}
        />
        <ChoiceRow label="Anime" detail="AniList catalog" selected badge="← recommended" />
        <ToggleRow label="Autoplay next" detail="Play next episode" on selected />
      </SetupFrame>,
      { columns: 100, rows: 40 },
    );
    const paletteFrame = captureFrame(
      <CommandPalette
        input="set"
        highlightedIndex={0}
        width={80}
        commands={[
          {
            id: "settings",
            label: "Settings",
            description: "Open settings",
            aliases: ["settings"],
            enabled: true,
          },
          {
            id: "downloads",
            label: "Downloads",
            description: "View download queue",
            aliases: ["downloads"],
            enabled: false,
            reason: "downloads disabled",
          },
        ]}
      />,
      { columns: 100, rows: 20 },
    );
    const overlayFrame = captureFrame(
      <Box flexDirection="column">
        <OverlayPanel
          width={80}
          overlay={{
            type: "provider",
            title: "Choose provider",
            subtitle: "Series lane",
            filterQuery: "",
            selectedIndex: 0,
            options: [
              { label: "VidLink", value: "vidlink", detail: "Primary", badge: "active" },
              { label: "Rivestream", value: "rivestream", detail: "Fallback" },
            ],
          }}
        />
        <OverlayLayoutProvider
          value={{ contentRows: 30, contentColumns: 80, chromeRows: 4, listMaxVisible: 10 }}
        >
          <GuideShell
            sections={[
              {
                title: "Browse",
                blurb: "Find things to watch",
                rows: [
                  {
                    command: "settings",
                    invocation: "/settings",
                    description: "Open preferences",
                    surface: "run",
                    enabled: true,
                    note: undefined,
                    reason: undefined,
                  },
                ],
              },
            ]}
            maxRows={10}
            commandMode={false}
            commandInput=""
            commandCursor={0}
            commands={[]}
            highlightedIndex={0}
            footerActions={[]}
            statusNote={null}
            onActivate={() => {}}
          />
        </OverlayLayoutProvider>
        <ActionList
          selectedIndex={0}
          rows={[{ id: "retry", label: "Retry", detail: "Try again", shortcut: "r" }]}
        />
        <ErrorShell message="No playable source found" onResolve={() => {}} />
      </Box>,
      { columns: 100, rows: 45 },
    );

    for (const frame of [setupFrame, paletteFrame, overlayFrame]) {
      expect(frame.length).toBeGreaterThan(0);
      expect(frame).not.toMatch(DECORATIVE_NOISE);
    }
    expect(setupFrame).toContain("[selected] [ok] mpv: 0.38");
    expect(setupFrame).toContain("[missing] yt-dlp: missing");
    expect(setupFrame).toContain("(recommended)");
    expect(setupFrame).toContain("[selected] [on] Autoplay next");
    expect(paletteFrame).toContain("Command palette (focused): /set");
    expect(paletteFrame).toContain("[selected] /settings — Open settings");
    expect(overlayFrame).toContain("[selected] VidLink");
    expect(overlayFrame).toContain("[selected] /settings — Open preferences");
    expect(overlayFrame).toContain("[selected] Retry");
    expect(overlayFrame).toContain("No playable source found");
  });

  test("help, language, and done setup screens are one column of words", () => {
    enablePlainMode();
    const help = captureFrame(
      <HelpShell
        sections={[
          {
            group: "Global",
            items: [
              { keys: "?", label: "Show this help" },
              { keys: "esc", label: "Close" },
              { keys: "tab", label: "Cycle sections" },
              { keys: "/", label: "Commands" },
            ],
          },
          {
            group: "Playback",
            items: [{ keys: "space", label: "Pause" }],
          },
        ]}
        scopeLabel="playing"
        commandMode={false}
        commandInput=""
        commandCursor={0}
        commands={[]}
        highlightedIndex={0}
        footerActions={[]}
        onClose={() => {}}
      />,
      { columns: 80, rows: 24 },
    );
    const setup = captureFrame(
      <>
        <LanguageScreen
          lanes={[
            { value: "series", label: "Shows" },
            { value: "anime", label: "Anime" },
          ]}
          activeLane="anime"
          audioOptions={[
            { value: "ja", label: "Japanese", detail: "Original audio" },
            { value: "en", label: "English", detail: "Dub" },
          ]}
          subtitleOptions={[
            { value: "en", label: "English", detail: "English subtitles" },
            { value: "off", label: "Off", detail: "No subtitles" },
          ]}
          audioIndex={0}
          subtitleIndex={0}
          focus="audio"
          contentWidth={70}
        />
        <DoneScreen
          headline="Ready to watch"
          summary={[{ ok: true, label: "Player", detail: "mpv found" }]}
          outstanding={[{ ok: false, label: "Downloads", detail: "yt-dlp missing" }]}
        />
      </>,
      { columns: 80, rows: 40 },
    );

    for (const frame of [help, setup]) {
      expect(frame.length).toBeGreaterThan(0);
      expect(frame).not.toMatch(DECORATIVE_NOISE);
    }
    expect(help).toContain("Help");
    expect(help).not.toContain("❀");
    expect(help).toContain("[active] Global");
    expect(help).not.toContain("[active] Playback");
    const helpLines = help.split("\n");
    const questionLine = helpLines.find((line) => line.includes("Show this help"));
    expect(questionLine).toBeDefined();
    expect(questionLine).not.toContain("Cycle sections");
    expect(setup).toContain("[active] Anime");
    expect(setup).toContain("[active] Audio");
    expect(setup).toContain("[selected] Japanese");
    expect(setup).toContain("[current] English");
    expect(setup).toContain("Subtitles");
    const audioLine = setup.split("\n").find((line) => line.includes("Audio"));
    expect(audioLine).not.toContain("Subtitles");
    expect(setup).toContain("[ok] Player");
    expect(setup).toContain("[warning] Downloads");
    expect(setup).not.toContain("❀");
  });

  test("playing, diagnostics, downloads, calendar, and library drop decorative glyphs", () => {
    enablePlainMode();
    const resume = libraryResumeCardCopy({
      titleName: "Andor",
      nextPlayableEpisodeLabel: "S01E02",
    });
    const frame = captureFrame(
      <>
        <LoadingShell
          state={{
            title: "Andor",
            subtitle: "S01E01",
            operation: "playing",
            bufferHealth: "buffering",
            upNextLabel: "S01E02",
            currentPosition: 30,
            duration: 120,
          }}
        />
        <LoadingShell
          state={{
            title: "Andor",
            operation: "playing",
            bufferHealth: "stalled",
            latestIssue: "Stream stalled",
            upNextLabel: "S01E03",
          }}
        />
        <OverlayPanel
          width={72}
          maxLinesOverride={6}
          overlay={{
            type: "diagnostics",
            title: "Diagnostics",
            subtitle: "Session",
            lines: [
              { label: "─── Verdict", detail: "", tone: "info" },
              { label: "Verdict", detail: "Playable", tone: "success" },
            ],
          }}
        />
        {(["running", "queued", "completed", "completed-with-notes", "failed"] as const).map(
          (status) => (
            <Text key={status}>{downloadQueueStatusLabel(status)}</Text>
          ),
        )}
        <CalendarScheduleRow
          option={{ value: "andor", label: "Andor" }}
          selected
          rowWidth={60}
          timeLabel="20:00"
          isNew
        />
        <CalendarScheduleRow
          option={{ value: "dune", label: "Dune" }}
          selected={false}
          rowWidth={60}
          timeLabel="21:00"
          tracked
        />
        <ResumeCard label={resume.label} action={resume.action} />
      </>,
      { columns: 100, rows: 80 },
    );

    expect(frame).not.toMatch(DECORATIVE_NOISE);
    expect(frame).toContain("[buffering] buffer");
    expect(frame).toContain("Up next: S01E02");
    expect(frame).toContain("Warning: Stream stalled");
    expect(frame).toContain("Up next: S01E03");
    expect(frame).toContain("Verdict");
    expect(frame).not.toContain("───");
    expect(frame).toContain("[downloading]");
    expect(frame).toContain("[queued]");
    expect(frame).toContain("[complete]");
    expect(frame).toContain("[playable]");
    expect(frame).toContain("[failed]");
    expect(frame).toContain("[new] Andor");
    expect(frame).toContain("[tracked] Dune");
    expect(frame).toContain("Resume: S01E02 offline (enter)");
    expect(frame).not.toContain("▸");
  });

  test("a wide playing frame keeps Up next and speaks media facts", () => {
    enablePlainMode();
    const frame = captureFrame(
      <>
        <LoadingShell
          state={{
            title: "Quartz Xenon",
            subtitle: "S01E01",
            operation: "playing",
            contentKind: "series",
            upNextLabel: "S01E02",
            hasNextEpisode: true,
            nextEpisodeLabel: "S01E02",
            nextEpisodeThumbUrl: "https://img.example/next.jpg",
            posterUrl: "https://img.example/poster.jpg",
            titleDetail: seriesDetail,
            currentPosition: 30,
            duration: 120,
          }}
          isFavorite={() => true}
        />
        <LoadingShell
          state={{
            title: "Live special",
            operation: "playing",
            contentKind: "video",
            videoMeta: { liveStatus: "live", channelTitle: "Stage" },
            upNextLabel: "Aftershow",
          }}
        />
        <MediaPanel
          railWidth={36}
          placementSlot="playing-rail"
          model={{
            kind: "series",
            kindBadge: "series",
            title: "Quartz Xenon",
            posterUrl: "https://img.example/poster.jpg",
            facts: [
              { label: "score", value: "★ 8.7" },
              { label: "live", value: "● live", tone: "error" },
              { label: "♥", value: "favourite", tone: "success" },
            ],
            miniCards: [
              {
                kind: "next",
                section: "up next",
                label: "S01E02",
                thumbUrl: "https://img.example/thumb.jpg",
              },
            ],
          }}
        />
      </>,
      { columns: 140, rows: 40 },
    );

    expect(frame).toContain("Up next: S01E02");
    expect(frame).toContain("Up next: Aftershow");
    expect(frame).toContain("score: 8.7");
    expect(frame).toContain("[live]");
    expect(frame).toContain("favourite: yes");
    expect(frame).toContain("S01E02");
    expect(frame).not.toContain("QX");
    expect(frame).not.toMatch(PLAIN_MODE_GLYPHS);
  });

  test("a settled library shelf speaks ready, protected, progress, issues, and delete", async () => {
    enablePlainMode();
    const frame = await libraryShelfFrames(80);
    expect(frame).toContain("Dune 1/1 ready [protected]");
    expect(frame).toContain("33%");
    expect(frame).toContain("1 issue");
    expect(frame).toContain("more above");
    expect(frame).toContain("more below");
    expect(frame).toContain("Warning: Press x again to delete Andor");
    expect(frame).not.toMatch(PLAIN_MODE_GLYPHS);
  });
});

const seriesDetail: TitleDetail = {
  id: "quartz",
  type: "series",
  title: "Quartz Xenon",
  score: 8.7,
  synopsis: "A colony watches the sky.",
};

function settingsRegistry(): SettingsRegistryContext {
  return {
    config: DEFAULT_CONFIG,
    presenceSnapshot: null,
    seriesProviderOptions: [],
    animeProviderOptions: [],
    youtubeProviderOptions: [],
    sync: {
      adapters: [],
      authAvailability: {
        anilist: {
          available: true as const,
          redirectUri: SHIPPED_ANILIST_REDIRECT_URI,
          clientIdSource: "shipped-default" as const,
        },
        tmdb: { available: true as const, apiKeySource: "shipped-fallback" as const },
      },
      status: {
        connected: 0,
        pending: 0,
        needsReauth: 0,
        deadLettered: 0,
        health: "disconnected" as const,
      },
    },
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    container: {} as Container,
  };
}

function offlineEntry(
  job: Partial<OfflineLibraryEntry["job"]> &
    Pick<OfflineLibraryEntry["job"], "id" | "titleId" | "titleName">,
  status: OfflineLibraryEntry["status"],
): OfflineLibraryEntry {
  // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
  return {
    job: {
      mediaKind: "movie",
      outputPath: `/tmp/${job.id}.mp4`,
      tempPath: `/tmp/${job.id}.part`,
      streamUrl: "https://example/title",
      headers: {},
      status: "completed",
      progressPercent: 100,
      fileSize: 1000,
      retryCount: 0,
      attempt: 1,
      maxAttempts: 3,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:00:00.000Z",
      providerId: "vidking",
      posterUrl: "https://img.example/poster.jpg",
      ...job,
    },
    status,
  } as OfflineLibraryEntry;
}

function libraryFixture() {
  const entries: readonly OfflineLibraryEntry[] = [
    offlineEntry(
      {
        id: "dune-job",
        titleId: "dune",
        titleName: "Dune",
        mediaKind: "movie",
        completedAt: "2026-08-03T00:00:00.000Z",
      },
      "ready",
    ),
    offlineEntry(
      {
        id: "blade-job",
        titleId: "blade",
        titleName: "Blade",
        mediaKind: "movie",
        completedAt: "2026-08-02T00:00:00.000Z",
      },
      "ready",
    ),
    offlineEntry(
      {
        id: "andor-job",
        titleId: "andor",
        titleName: "Andor",
        mediaKind: "series",
        season: 1,
        episode: 1,
        completedAt: "2026-08-01T00:00:00.000Z",
      },
      "missing",
    ),
  ];
  const history: HistoryProgress = {
    key: "dune",
    titleId: "dune",
    mediaKind: "movie",
    title: "Dune",
    positionSeconds: 33,
    durationSeconds: 100,
    completed: false,
    updatedAt: "2026-08-03T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
  const container = {
    config: {
      zenMode: false,
      downloadsEnabled: true,
      protectedDownloadJobIds: ["dune-job"],
      update: async () => undefined,
      save: async () => undefined,
    },
    downloadService: {
      listActive: () => [],
      listCompleted: () => [],
      listFailed: () => [],
      onEvent: () => () => undefined,
      deleteJob: async () => ({ status: "deleted", jobId: "dune-job" }),
      abort: async () => undefined,
      retry: async () => undefined,
      kickQueue: () => undefined,
      repairRepairableSidecars: async () => ({
        checked: 0,
        repaired: 0,
        stillRepairable: 0,
        failed: 0,
      }),
    },
    offlineLibraryService: {
      listCompletedEntries: async () => {
        await gate;
        return entries;
      },
    },
    historyRepository: {
      listLatestByTitle: () => [history],
      listByTitle: () => [],
    },
    stateManager: { dispatch: () => undefined },
    connectivity: { isOnline: () => true, subscribe: () => () => undefined },
  } as never;
  return {
    container,
    settle: async () => {
      open();
      await gate;
    },
  };
}

/** Frames from the settled shelf, then scrolled, then delete-armed. */
async function libraryShelfFrames(columns: number): Promise<string> {
  const { container, settle } = libraryFixture();
  const handle = render(<LibraryShell container={container} onClose={() => undefined} />, {
    columns,
    rows: 22,
  });
  try {
    await act(async () => {
      await settle();
    });
    const frames = [stripAnsi(handle.lastFrame())];
    handle.stdin.enqueue("\u001b[B");
    frames.push(stripAnsi(handle.lastFrame()));
    handle.stdin.enqueue("\u001b[B");
    frames.push(stripAnsi(handle.lastFrame()));
    handle.stdin.enqueue("x");
    frames.push(stripAnsi(handle.lastFrame()));
    return frames.join("\n");
  } finally {
    handle.unmount();
  }
}

function completedDownload(): DownloadJobRecord {
  // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
  return {
    id: "job-1",
    titleId: "title-1",
    titleName: "Frieren",
    status: "completed",
    mediaKind: "anime",
    mode: "series",
    providerId: "videasy",
    season: 1,
    episode: 3,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    progressPercent: 100,
    outputPath: "/tmp/frieren.mp4",
  } as DownloadJobRecord;
}

function downloadContainer(): Container {
  const job = completedDownload();
  // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
  return {
    stateManager: { dispatch: () => undefined },
    config: { zenMode: false },
    downloadService: {
      listActive: () => [],
      listCompleted: () => [job],
      listFailed: () => [],
      onEvent: () => () => undefined,
      repairRepairableSidecars: async () => ({
        checked: 0,
        repaired: 0,
        stillRepairable: 0,
        failed: 0,
      }),
      abort: async () => undefined,
      deleteJob: async () => ({ status: "deleted", jobId: job.id }),
      retry: async () => undefined,
      kickQueue: () => undefined,
    },
  } as never;
}

function diagnosticSpanLines() {
  const recentEvents: DiagnosticEvent[] = [
    {
      timestamp: 2,
      level: "error",
      category: "playback",
      message: "phase failed",
      operation: "playback.phase.failed",
      playbackCycleId: "open",
      context: { severity: "blocked" },
    },
    {
      timestamp: 1,
      level: "info",
      category: "playback",
      message: "launched",
      operation: "mpv.launch.started",
      playbackCycleId: "closed",
      context: { severity: "healthy" },
    },
  ];
  const model = buildDiagnosticsPanelModel({ recentEvents });
  return flattenDiagnosticsPanelSpans(model, new Set(["open"])).map((line) => ({
    label: line.label,
    detail: line.detail,
    tone: line.tone,
  }));
}

function calendarDays() {
  return Array.from({ length: 10 }, (_, index) => ({
    key: `2026-11-${String(index + 1).padStart(2, "0")}`,
    label: `DAY ${index + 1}`,
    isToday: index === 5,
  }));
}

describe("plain mode glyph guard", () => {
  beforeEach(() => {
    savedPlain = process.env.KUNAI_PLAIN;
  });

  afterEach(() => {
    setPlainModePreferenceSource(() => false);
    if (savedPlain === undefined) delete process.env.KUNAI_PLAIN;
    else process.env.KUNAI_PLAIN = savedPlain;
  });

  test("root shells and overlays at 80 and 140 columns stay free of decorative glyphs", async () => {
    enablePlainMode();
    const days = calendarDays();
    const registry = settingsRegistry();
    const page = buildSettingsPage(registry, { activeSectionIndex: 0 });
    const settingsState = {
      ...createSettingsUiState(DEFAULT_CONFIG),
      selectedIndex: Math.floor(page.rows.length / 2),
    };

    for (const columns of [80, 140]) {
      const staticFrame = captureFrame(
        <>
          <LoadingShell
            state={{
              title: "Quartz Xenon",
              subtitle: "S01E01",
              operation: "playing",
              contentKind: "series",
              upNextLabel: "S01E02",
              hasNextEpisode: true,
              nextEpisodeLabel: "S01E02",
              nextEpisodeThumbUrl: "https://img.example/next.jpg",
              posterUrl: "https://img.example/poster.jpg",
              titleDetail: seriesDetail,
              currentPosition: 40,
              duration: 120,
            }}
            isFavorite={() => true}
          />
          <PostPlayShell
            title="Quartz Xenon"
            episodeLabel="S01E01"
            nextEpisodeLabel="S01E02"
            nextEpisodeThumbUrl="https://img.example/next.jpg"
            posterUrl="https://img.example/poster.jpg"
            titleDetail={seriesDetail}
            isFavorite
            postPlayState={{ kind: "mid-series" }}
            selectedActionIndex={0}
            totalEpisodes={12}
            watchedEpisodes={3}
          />
          <MediaPanel
            railWidth={36}
            placementSlot="postplay-rail"
            model={{
              kind: "series",
              kindBadge: "series",
              title: "Quartz Xenon",
              facts: [
                { label: "score", value: "★ 8.7" },
                { label: "live", value: "● live", tone: "error" },
                { label: "♥", value: "favourite", tone: "success" },
              ],
              miniCards: [
                {
                  kind: "next",
                  section: "up next",
                  label: "S01E02",
                  thumbUrl: "https://img.example/thumb.jpg",
                },
              ],
            }}
          />
          <HelpShell
            sections={[
              {
                group: "Global",
                items: [
                  { keys: "?", label: "Show this help" },
                  { keys: "esc", label: "Close" },
                ],
              },
            ]}
            scopeLabel="playing"
            commandMode={false}
            commandInput=""
            commandCursor={0}
            commands={[]}
            highlightedIndex={0}
            footerActions={[]}
            onClose={() => {}}
          />
          <CalendarDayStrip days={days} selectedDayKey={days[4]?.key ?? null} />
          <CalendarTypeTabs activeTab="TV" compact={false} maxWidth={140} />
          <CalendarScheduleRow
            option={{ value: "andor", label: "Andor" }}
            selected
            rowWidth={Math.max(40, columns - 8)}
            timeLabel="20:00"
            isNew
          />
          <SettingsOverlay
            page={page}
            state={settingsState}
            registryCtx={registry}
            width={columns}
            maxRows={4}
            error={null}
          />
          <OverlayPanel
            width={columns}
            maxLinesOverride={12}
            overlay={{
              type: "diagnostics",
              title: "Diagnostics",
              subtitle: "Session",
              lines: diagnosticSpanLines(),
            }}
          />
          <DependencyScreen
            rows={[
              {
                id: "mpv",
                name: "mpv",
                state: "ok",
                detail: "0.38",
                role: "player",
                fix: null,
                scope: "always",
              },
            ]}
            selected={0}
            rechecking={false}
            tick={0}
            showFix={false}
          />
          <ModeScreen selected={0} />
          <LanguageScreen
            lanes={[{ value: "series", label: "Shows" }]}
            activeLane="series"
            audioOptions={[{ value: "ja", label: "Japanese", detail: "Original" }]}
            subtitleOptions={[
              { value: "en", label: "English", detail: "Subtitles" },
              { value: "off", label: "Off", detail: "None" },
            ]}
            audioIndex={0}
            subtitleIndex={0}
            focus="audio"
          />
          <LibraryScreen
            toggles={{
              downloadsEnabled: true,
              downloadQuality: "1080p",
              autoNext: true,
              skipIntro: false,
              skipCredits: false,
              connectAniList: false,
              connectTmdb: false,
              presenceDiscord: false,
            }}
            selected={0}
            ytDlpReady
            downloadPath="/tmp/kunai"
          />
          <DoneScreen
            headline="Ready"
            summary={[{ ok: true, label: "Player", detail: "mpv found" }]}
            outstanding={[{ ok: false, label: "Downloads", detail: "yt-dlp missing" }]}
          />
        </>,
        { columns, rows: 48 },
      );

      const downloads = render(
        <DownloadManagerContent container={downloadContainer()} onClose={() => undefined} />,
        { columns, rows: 30 },
      );
      downloads.stdin.enqueue("x");
      const downloadFrame = stripAnsi(downloads.lastFrame());
      downloads.unmount();

      const libraryFrame = await libraryShelfFrames(columns);
      const frame = [staticFrame, downloadFrame, libraryFrame].join("\n");

      expect(frame).toContain("Up next: S01E02");
      expect(frame).toContain("score: 8.7");
      expect(frame).toContain("favourite: yes");
      expect(frame).toContain("[expanded]");
      expect(frame).toContain("[collapsed]");
      expect(frame).toContain("Warning:");
      expect(frame).toContain("1/1 ready");
      expect(frame).toContain("[protected]");
      expect(frame).toContain("33%");
      expect(frame).toContain("1 issue");
      expect(frame).toContain("more above");
      expect(frame).toContain("more below");
      expect(frame).toContain("[current] English");
      expect(frame).toContain("[active]");
      expect(frame).toContain("(today)");
      expect(frame).toContain("previous");
      expect(frame).toContain("next");
      expect(frame).toContain("Tab cycles type");
      expect(frame).toContain("Help");
      expect(frame).not.toMatch(PLAIN_MODE_GLYPHS);
    }
  });
});
