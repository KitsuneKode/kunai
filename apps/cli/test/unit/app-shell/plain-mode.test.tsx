import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { AnalyticsDisclosureBanner } from "@/app-shell/AnalyticsDisclosureBanner";
import { CapabilityIssueStrip } from "@/app-shell/CapabilityIssueStrip";
import { companionMode, companionToggleable } from "@/app-shell/companion-policy";
import { DetailsSheetUI, TitleDetailSheetUI } from "@/app-shell/details-pane-ui";
import { DetailsSheet } from "@/app-shell/details-sheet-ui";
import { ExitShell } from "@/app-shell/exit-shell";
import { compactProgressBar } from "@/app-shell/format/bar";
import { GuideShell } from "@/app-shell/guide-shell";
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
import { SectionGroup } from "@/app-shell/primitives/SectionGroup";
import { SegmentedControl } from "@/app-shell/primitives/SegmentedControl";
import { StateBlock } from "@/app-shell/primitives/StateBlock";
import { BooleanSwitch } from "@/app-shell/primitives/Switch";
import { ErrorShell, RootIdleShell } from "@/app-shell/root-status-shells";
import { SakuraLoader } from "@/app-shell/SakuraLoader";
import { SettingRowBoolean } from "@/app-shell/settings/components/SettingRowBoolean";
import { SettingRowSubmenu } from "@/app-shell/settings/components/SettingRowSubmenu";
import { SettingsSearchBar } from "@/app-shell/settings/components/SettingsSearchBar";
import { appearanceSettingsRows } from "@/app-shell/settings/registry/appearance";
import { ChoiceRow, SetupFrame, ToggleRow } from "@/app-shell/setup/SetupFrame";
import { DependencyScreen } from "@/app-shell/setup/SetupScreens";
import { CommandPalette } from "@/app-shell/shell-command-ui";
import { InputField } from "@/app-shell/shell-frame";
import { EmptyState, Footer } from "@/app-shell/shell-primitives";
import { SearchSuggestionBand } from "@/app-shell/suggestion-band-ui";
import { TracksPanelShell } from "@/app-shell/tracks-panel-shell";
import { createInitialState } from "@/domain/session/SessionState";
import { buildHelpText, parseArgs } from "@/main";
import type { CapabilitySnapshot } from "@/ui";
import { DEFAULT_CONFIG } from "@kunai/config";
import { Box } from "ink";

import { captureFrame } from "../../harness/render-capture";

/** Box-drawing lines and decorative glyphs that screen readers announce as noise. */
const DECORATIVE_NOISE = /[┌┐└┘─│╭╮╰╯🦊❀✿❁✾▌█┈░▰▱◉○●◆◈▲▼]/u;

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

  test("--plain parses cleanly and is documented in --help", () => {
    expect(parseArgs(["--plain"]).plain).toBe(true);
    expect(parseArgs([]).plain).toBe(false);
    expect(buildHelpText()).toContain("--plain");
  });

  test("plainMode setting exists in appearance settings and toggles both ways", () => {
    const rows = appearanceSettingsRows();
    const plainRow = rows.find((row) => row.id === "plainMode");
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
        <EmptyState title="No bookmarks" subtitle="Save a title first." />
        <LoadingState message="Fetching catalog" active />
        <SakuraLoader label="Resolving sources" sublabel="esc to cancel" active />
      </Box>,
      { columns: 100, rows: 25 },
    );
    const missingMpvSnapshot: CapabilitySnapshot = {
      mpv: false,
      mpvRequired: true,
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
    expect(controls).toContain("Empty: No bookmarks");
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
    expect(frame).toContain("[selected] [on] Plain / screen-reader mode");
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
    expect(frame).toContain("[in progress] Providers");
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
});
