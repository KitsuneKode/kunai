import { useLineEditor } from "@/app-shell/line-editor";
import type { Container } from "@/container";
import type { HistoryReleaseSignal } from "@/domain/continuation/history-bucket";
import type { ContinueHistoryRelease } from "@/domain/continuation/history-reconciliation";
import { mediaItemFromHistoryEntry } from "@/domain/media/media-item-adapters";
import { sortByFavorites, toggleFavoriteSource } from "@/domain/playback/source-name";
import { encodeTrackSelection } from "@/domain/playback/track-capabilities";
import { rankFuzzyMatches } from "@/domain/session/fuzzy-match";
import type { SessionState } from "@/domain/session/SessionState";
import { historyContentType } from "@/services/continuation/history-progress";
import { getRuntimeMemorySamples } from "@/services/diagnostics/runtime-memory";
import { MediaActionRouter } from "@/services/media-actions/MediaActionRouter";
import {
  NotificationActionRouter,
  type NotificationActionId,
} from "@/services/notifications/NotificationActionRouter";
import type {
  AutoDownloadMode,
  DiscoverMode,
  KitsuneConfig,
  QuitNearEndBehavior,
  QuitNearEndThresholdMode,
  RecoveryMode,
} from "@/services/persistence/ConfigService";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";
import type { StartupPriority } from "@kunai/types";
import { Box, Text, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState } from "react";

import { resolveCommandContext, type ResolvedAppCommand } from "./commands";
import { DownloadManagerContent } from "./download-manager-shell";
import { HistoryShell } from "./history-shell";
import {
  buildHistoryView,
  cycleHistoryTab,
  historyTabFromLegacy,
  type HistoryTab,
} from "./history-view";
import { LibraryShell } from "./library-shell";
import {
  buildNotificationActionOptions,
  buildNotificationPickerOptions,
  getNotificationPrimaryAction,
} from "./notification-overlay-model";
import {
  buildSettingsChoiceOverlay,
  buildSettingsOptions,
  buildSettingsProviderOptions,
  buildSettingsSummary,
  type BrowseOverlay,
  OverlayPanel,
  settingsEqual,
  type SettingsChoiceValue,
} from "./overlay-panel";
import {
  buildAboutPanelLines,
  buildDiagnosticsPanelLines,
  buildHelpPanelLines,
  buildHistoryPanelLines,
  buildProviderPickerOptions,
  type HistoryPickerOptionsContext,
} from "./panel-data";
import { shouldRenderPreviewRail } from "./primitives/PreviewRail";
import {
  buildRootHistorySelection,
  hasPendingRootHistorySelection,
  resolveRootHistorySelection,
  releaseProgressToContinueHistoryRelease,
  type RootHistorySelection,
} from "./root-history-bridge";
import {
  buildRootGenericPickerOptions,
  getRootOverlayInitialIndex,
  getRootOverlayResetKey,
  getRootOverlaySubtitle,
  getRootOverlayTitle,
  isRootChoiceOverlay,
  isRootMediaPickerOverlay,
} from "./root-overlay-model";
import { type RootOwnedOverlay } from "./root-shell-state";
import { CommandPalette, useShellInput } from "./shell-command-ui";
import { ContextStrip, ShellFooter } from "./shell-primitives";
import { palette } from "./shell-theme";
import {
  createInitialTracksNav,
  tracksPanelNavReducer,
  type TracksNavState,
} from "./tracks-panel-nav";
import { TracksPanelShell } from "./tracks-panel-shell";
import type { FooterAction, ShellPanelLine } from "./types";

/** Stable empty favorites reference for non-tracks overlays (keeps effect deps referentially stable). */
const EMPTY_TRACKS_FAVORITES: readonly string[] = [];

const HELP_TABS = ["Navigation", "Playback", "Commands", "About"] as const;
type HelpTab = (typeof HELP_TABS)[number];

const HELP_TAB_ROWS: Record<HelpTab, readonly { key: string; desc: string }[]> = {
  Navigation: [
    { key: "↑↓  jk", desc: "move through list" },
    { key: "enter", desc: "select / play" },
    { key: "esc  q", desc: "back / quit" },
    { key: "/", desc: "open command palette" },
    { key: "tab", desc: "toggle mode (anime / series)" },
  ],
  Playback: [
    { key: "space", desc: "pause / resume" },
    { key: "← →", desc: "seek 5 seconds" },
    { key: "[ ]", desc: "seek 85 seconds (op skip)" },
    { key: "n  p", desc: "next / previous episode" },
    { key: "s", desc: "cycle subtitle track" },
    { key: "q", desc: "stop and return to browse" },
  ],
  Commands: [
    { key: "/history", desc: "watch history" },
    { key: "/continue", desc: "continue watching" },
    { key: "/discover", desc: "recommendations" },
    { key: "/calendar", desc: "airing schedule" },
    { key: "/settings", desc: "preferences" },
    { key: "/diagnostics", desc: "system diagnostics" },
  ],
  About: [{ key: "runtime", desc: "Bun + Ink" }],
} as const;

function HelpShell({
  commandMode,
  commandInput,
  commandCursor,
  commands,
  highlightedIndex,
  footerActions,
}: {
  commandMode: boolean;
  commandInput: string;
  commandCursor: number;
  commands: readonly ResolvedAppCommand[];
  highlightedIndex: number;
  footerActions: readonly FooterAction[];
}) {
  const [activeTab, setActiveTab] = useState<HelpTab>("Navigation");

  useInput(
    (input, key) => {
      if (commandMode) return;
      if (key.tab) {
        setActiveTab((prev) => {
          const idx = HELP_TABS.indexOf(prev);
          return HELP_TABS[(idx + 1) % HELP_TABS.length] ?? "Navigation";
        });
      }
    },
    { isActive: !commandMode },
  );

  const rows = HELP_TAB_ROWS[activeTab];

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1}>
        <Text color={palette.text} bold>
          {"▸ Help"}
        </Text>
        <Text color={palette.dim}>{"Tab cycles sections · Esc closes"}</Text>
        {/* Tab strip */}
        <Box flexDirection="row" marginTop={1} marginBottom={0}>
          {HELP_TABS.map((tab) => (
            <Box key={tab} marginRight={3} flexDirection="column">
              <Text color={activeTab === tab ? palette.accent : palette.dim}>{tab}</Text>
              {activeTab === tab ? (
                <Text color={palette.accent}>{"─".repeat(tab.length)}</Text>
              ) : null}
            </Box>
          ))}
        </Box>
        {/* Tab content */}
        <Box flexDirection="column" marginTop={1}>
          {rows.map((row) => (
            <Box key={row.key} flexDirection="row" marginBottom={0}>
              <Text color={palette.text}>{row.key.padEnd(16)}</Text>
              <Text color={palette.dim}>{row.desc}</Text>
            </Box>
          ))}
        </Box>
      </Box>
      <Box flexDirection="column">
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            cursor={commandCursor}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}
        <ShellFooter
          taskLabel={"Help  ·  Tab cycles sections, Esc closes"}
          actions={footerActions}
          mode="detailed"
          commandMode={commandMode}
        />
      </Box>
    </Box>
  );
}

function nextSelectableIndex(
  options: readonly { value: unknown }[],
  from: number,
  delta: number,
): number {
  const len = options.length;
  if (len === 0) return 0;
  let idx = (((from + delta) % len) + len) % len;
  for (let i = 0; i < len; i++) {
    const v = options[idx]?.value;
    if (typeof v !== "string" || !v.startsWith("section:")) return idx;
    idx = (((idx + delta) % len) + len) % len;
  }
  return from;
}

function isSafeDiscordOpenUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "kunai:";
  } catch {
    return false;
  }
}

function isLikelyVideasySessionToken(value: string): boolean {
  return value.length >= 16 && !/\s/.test(value);
}

function getLatestPresenceErrorDetail(container: Container): string | null {
  const event = container.diagnosticsStore
    .getRecent(20)
    .find((entry) => entry.category === "presence" && entry.context?.error);
  const raw = event?.context?.error;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return raw.trim();
}

function readCachedHistoryNextReleases(
  entries: ReadonlyArray<[string, RootHistorySelection["entry"]]>,
  cachedProgress: ReadonlyMap<string, import("@kunai/storage").ReleaseProgressProjection>,
): NonNullable<HistoryPickerOptionsContext["nextReleases"]> {
  const releases = new Map<string, ContinueHistoryRelease>();
  for (const [titleId] of entries) {
    const release = releaseProgressToContinueHistoryRelease(cachedProgress.get(titleId));
    if (release) releases.set(titleId, release);
  }
  return releases;
}

function readCachedHistoryReleaseSignals(
  entries: ReadonlyArray<[string, RootHistorySelection["entry"]]>,
  cachedProgress: ReadonlyMap<string, import("@kunai/storage").ReleaseProgressProjection>,
): NonNullable<HistoryPickerOptionsContext["releaseSignals"]> {
  const signals = new Map<string, HistoryReleaseSignal>();
  for (const [titleId] of entries) {
    const projection = cachedProgress.get(titleId);
    if (!projection) continue;
    signals.set(titleId, {
      status: projection.status,
      newEpisodeCount: projection.newEpisodeCount,
      latestKnownReleaseAt: projection.latestKnownReleaseAt ?? null,
    });
  }
  return signals;
}

function readCachedHistoryProjections(
  entries: ReadonlyArray<[string, RootHistorySelection["entry"]]>,
  container: Container,
  cachedProgress: ReadonlyMap<string, import("@kunai/storage").ReleaseProgressProjection>,
): NonNullable<HistoryPickerOptionsContext["projections"]> {
  const titleIds = entries.map(([titleId]) => titleId);
  const policies = new Map(
    container.offlineTitlePolicies
      .listByTitleIds(titleIds)
      .map((policy) => [policy.titleId, policy]),
  );
  const nextReadyAssets = container.offlineAssetService.listNextReadyByTitleCursors(
    entries
      .filter(([, entry]) => historyContentType(entry) === "series")
      .map(([titleId, entry]) => ({
        titleId,
        season: entry.season ?? 1,
        episode: entry.episode ?? entry.absoluteEpisode ?? 1,
      })),
  );
  const nextReadyByTitle = new Map<string, { season: number; episode: number; jobId?: string }>();
  for (const asset of nextReadyAssets) {
    if (asset.season === undefined || asset.episode === undefined) continue;
    nextReadyByTitle.set(asset.titleId, {
      season: asset.season,
      episode: asset.episode,
      jobId: asset.originJobId,
    });
  }
  const projections = new Map();
  for (const [titleId, entry] of entries) {
    const releaseProgress = cachedProgress.get(titleId);
    const nextRelease = releaseProgressToContinueHistoryRelease(releaseProgress);
    const policy = policies.get(titleId);
    projections.set(
      titleId,
      container.continuationProjectionService.project({
        titleId,
        entries,
        nextRelease:
          nextRelease &&
          nextRelease.season !== undefined &&
          nextRelease.episode !== undefined &&
          historyContentType(entry) === "series"
            ? {
                season: nextRelease.season,
                episode: nextRelease.episode,
                released: nextRelease.status === "released",
                availableAt: nextRelease.releaseAt ?? undefined,
              }
            : null,
        releaseProgress: releaseProgress
          ? {
              newEpisodeCount: releaseProgress.newEpisodeCount,
              stale: Date.parse(releaseProgress.staleAfterAt) <= Date.now(),
            }
          : null,
        offline:
          policy || nextReadyByTitle.has(titleId)
            ? {
                enrolled: policy?.enrolled === true,
                readyNextEpisodes: (() => {
                  const nextReady = nextReadyByTitle.get(titleId);
                  return nextReady ? [nextReady] : [];
                })(),
              }
            : null,
      }),
    );
  }
  return projections;
}

export function RootOverlayShell({
  overlay,
  state,
  container,
  onRedraw,
}: {
  overlay: RootOwnedOverlay;
  state: SessionState;
  container: Container;
  onRedraw: () => void;
}) {
  const { stdout } = useStdout();
  const maxLines = Math.max(6, Math.min(12, (stdout.rows ?? 24) - 18));
  const [scrollIndex, setScrollIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tracksNav, setTracksNav] = useState<TracksNavState>(() => createInitialTracksNav({}));
  const [tracksFavorites, setTracksFavorites] = useState<readonly string[]>(
    overlay.type === "tracks_panel" ? overlay.favorites : EMPTY_TRACKS_FAVORITES,
  );
  const pickerFilterQuery = isRootMediaPickerOverlay(overlay)
    ? (overlay.filterQuery ?? "")
    : filterQuery;
  const pickerSelectedIndex = isRootMediaPickerOverlay(overlay)
    ? (overlay.selectedIndex ?? (overlay.type === "episode_picker" ? overlay.initialIndex : 0) ?? 0)
    : selectedIndex;
  const filterEditor = useLineEditor({
    value: pickerFilterQuery,
    onChange: (nextValue) => {
      if (isRootMediaPickerOverlay(overlay)) {
        if (!overlay.id) return;
        container.stateManager.dispatch({
          type: "UPDATE_PICKER_FILTER",
          id: overlay.id,
          filterQuery: nextValue,
        });
        return;
      }
      setFilterQuery(nextValue);
      if (overlay.type === "settings") {
        const nextFiltered = rankFuzzyMatches(settingsPanel?.options ?? [], nextValue, (option) => [
          { value: option.label, weight: 0 },
          { value: option.detail, weight: 8 },
        ]);
        setSelectedIndex(nextSelectableIndex(nextFiltered, -1, 1));
      } else {
        setSelectedIndex(0);
      }
    },
    onRedraw,
  });
  const [asyncLines, setAsyncLines] = useState<readonly ShellPanelLine[] | null>(null);
  const [loadingAsyncLines, setLoadingAsyncLines] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<KitsuneConfig | null>(null);
  const [settingsChoice, setSettingsChoice] = useState<SettingsChoiceValue | null>(null);
  const [settingsParentIndex, setSettingsParentIndex] = useState(0);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [overlayStatus, setOverlayStatus] = useState<string | null>(null);
  const [notificationActionDedupKey, setNotificationActionDedupKey] = useState<string | null>(null);
  const [historySelections, setHistorySelections] = useState<readonly RootHistorySelection[]>([]);
  const [historyNextReleases, setHistoryNextReleases] = useState<
    NonNullable<HistoryPickerOptionsContext["nextReleases"]>
  >(new Map());
  const [historyProjections, setHistoryProjections] = useState<
    NonNullable<HistoryPickerOptionsContext["projections"]>
  >(new Map());
  const [historyReleaseSignals, setHistoryReleaseSignals] = useState<
    NonNullable<HistoryPickerOptionsContext["releaseSignals"]>
  >(new Map());
  const initialHistoryTab =
    overlay.type === "history"
      ? historyTabFromLegacy(overlay.initialFilterMode ?? "all")
      : ("all" satisfies HistoryTab);
  const [historyTab, setHistoryTab] = useState<HistoryTab>(initialHistoryTab);
  const overlayResetKey = getRootOverlayResetKey(overlay);
  const overlayInitialIndex = getRootOverlayInitialIndex(overlay);
  const trackGroups = overlay.type === "tracks_panel" ? overlay.groups : [];
  const tracksFavoritesSnapshot =
    overlay.type === "tracks_panel" ? overlay.favorites : EMPTY_TRACKS_FAVORITES;
  const tracksInitialSectionIndex =
    overlay.type === "tracks_panel"
      ? Math.max(
          0,
          overlay.groups.findIndex((group) => group.section === overlay.initialSection),
        )
      : 0;
  const commands = resolveCommandContext(state, "rootOverlay");
  const historyPickerContext: HistoryPickerOptionsContext = {
    nextReleases: historyNextReleases,
    projections: historyProjections,
    releaseSignals: historyReleaseSignals,
  };
  const settingsSeriesProviderOptions = buildSettingsProviderOptions({
    providers: container.providerRegistry
      .getAll()
      .map((p) => p.metadata)
      .filter((metadata) => !metadata.isAnimeProvider),
    currentProvider: settingsDraft?.provider ?? container.config.provider,
  });
  const settingsAnimeProviderOptions = buildSettingsProviderOptions({
    providers: container.providerRegistry
      .getAll()
      .map((p) => p.metadata)
      .filter((metadata) => metadata.isAnimeProvider),
    currentProvider: settingsDraft?.animeProvider ?? container.config.animeProvider,
  });
  const staticLines =
    overlay.type === "help"
      ? buildHelpPanelLines()
      : overlay.type === "about"
        ? buildAboutPanelLines({
            config: container.config.getRaw(),
            state,
            capabilitySnapshot: container.capabilitySnapshot,
          })
        : overlay.type === "diagnostics"
          ? buildDiagnosticsPanelLines({
              state,
              recentEvents: container.diagnosticsStore.getRecent(25),
              capabilitySnapshot: container.capabilitySnapshot,
              downloadSummary: {
                active: container.downloadService.listActive(200).length,
                completed: container.downloadService.listCompleted(200).length,
                failed: container.downloadService.listFailed(200).length,
              },
              presenceSnapshot: container.presence.getSnapshot(),
              memorySamples: getRuntimeMemorySamples(),
            })
          : [];
  const lines = overlay.type === "history" ? (asyncLines ?? []) : staticLines;
  const providerOptions =
    overlay.type === "provider_picker"
      ? buildProviderPickerOptions({
          providers: container.providerRegistry
            .getAll()
            .map((p) => p.metadata)
            .filter((metadata) => metadata.isAnimeProvider === overlay.isAnime),
          currentProvider: overlay.currentProvider,
        })
      : [];
  const providerInitialIndex =
    overlay.type === "provider_picker"
      ? Math.max(
          0,
          providerOptions.findIndex((option) => option.value === overlay.currentProvider),
        )
      : 0;
  const genericPickerOptions =
    overlay.type === "season_picker" ||
    overlay.type === "episode_picker" ||
    overlay.type === "subtitle_picker" ||
    overlay.type === "recommendation_picker"
      ? buildRootGenericPickerOptions(overlay)
      : [];
  const filteredProviderOptions = rankFuzzyMatches(providerOptions, filterQuery, (option) => [
    { value: option.label, weight: 0 },
    { value: option.detail, weight: 8 },
  ]);
  const filteredGenericPickerOptions = rankFuzzyMatches(
    genericPickerOptions,
    pickerFilterQuery,
    (option) => [
      { value: option.label, weight: 0 },
      { value: option.detail, weight: 8 },
      { value: option.badge, weight: 12 },
    ],
  );
  const historyView = useMemo(
    () =>
      buildHistoryView({
        entries: historySelections.map(({ titleId, entry }) => [titleId, entry] as const),
        tab: historyTab,
        filterQuery,
        selectedIndex,
        maxVisible: maxLines,
        narrow: (stdout.columns ?? 80) < 124,
        context: {
          nextReleases: historyNextReleases,
          projections: historyProjections,
          releaseSignals: historyReleaseSignals,
        },
        loading: overlay.type === "history" ? loadingAsyncLines : false,
      }),
    [
      filterQuery,
      historyNextReleases,
      historyProjections,
      historyReleaseSignals,
      historySelections,
      historyTab,
      loadingAsyncLines,
      maxLines,
      overlay.type,
      selectedIndex,
      stdout.columns,
    ],
  );
  const notificationRecords =
    overlay.type === "notifications" ? container.notificationService.listActive() : [];
  const filteredNotificationOptions =
    overlay.type === "notifications"
      ? rankFuzzyMatches(
          buildNotificationPickerOptions(notificationRecords),
          filterQuery,
          (option) => [
            { value: option.label, weight: 0 },
            { value: option.detail, weight: 8 },
            { value: option.badge, weight: 12 },
          ],
        )
      : [];
  const selectedNotificationForActions =
    overlay.type === "notifications" && notificationActionDedupKey
      ? (notificationRecords.find((record) => record.dedupKey === notificationActionDedupKey) ??
        null)
      : null;
  const filteredNotificationActionOptions = selectedNotificationForActions
    ? rankFuzzyMatches(
        buildNotificationActionOptions(selectedNotificationForActions),
        filterQuery,
        (option) => [
          { value: option.label, weight: 0 },
          { value: option.detail, weight: 8 },
        ],
      )
    : [];
  const settingsPanel =
    overlay.type === "settings" && settingsDraft
      ? settingsChoice
        ? buildSettingsChoiceOverlay({
            config: settingsDraft,
            setting: settingsChoice,
            seriesProviderOptions: settingsSeriesProviderOptions,
            animeProviderOptions: settingsAnimeProviderOptions,
            parentSelectedIndex: settingsParentIndex,
          })
        : ({
            type: "settings",
            title: "Settings",
            subtitle: buildSettingsSummary(settingsDraft),
            options: buildSettingsOptions(settingsDraft, container.presence.getSnapshot()),
            filterQuery: "",
            selectedIndex,
            dirty: !settingsEqual(settingsDraft, container.config.getRaw()),
            busy: settingsBusy,
          } satisfies Extract<BrowseOverlay, { type: "settings" }>)
      : null;
  const filteredSettingsOptions = rankFuzzyMatches(
    settingsPanel?.options ?? [],
    filterQuery,
    (option) => [
      { value: option.label, weight: 0 },
      { value: option.detail, weight: 8 },
    ],
  );
  const title = getRootOverlayTitle(overlay, state);
  const subtitle = getRootOverlaySubtitle({
    overlay,
    state,
    settingsDraft,
    config: container.config.getRaw(),
    settingsError,
  });
  const effectiveSubtitle =
    (overlay.type === "notifications" || overlay.type === "history") && overlayStatus
      ? overlayStatus
      : subtitle;
  const footerActions: readonly FooterAction[] = [
    // Media pickers carry their nav keys in the footer so the title can be the
    // single hint line (no duplicate "Type to filter, Enter to select" guidance).
    ...(isRootMediaPickerOverlay(overlay)
      ? ([
          { key: "↑↓", label: "select", action: "details" as const },
          { key: "enter", label: "open", action: "details" as const, primary: true },
        ] satisfies readonly FooterAction[])
      : []),
    { key: "/", label: "commands", action: "command-mode" },
    { key: "esc", label: "close", action: "quit" },
  ];
  const { commandMode, commandInput, commandCursor, highlightedIndex } = useShellInput({
    footerActions,
    commands,
    escapeAction: null,
    onResolve: (action) => {
      if (
        action === "settings" ||
        action === "presence" ||
        action === "help" ||
        action === "about" ||
        action === "diagnostics" ||
        action === "downloads" ||
        action === "notifications" ||
        action === "history" ||
        action === "provider"
      ) {
        if (isRootMediaPickerOverlay(overlay) && overlay.id) {
          container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
        } else {
          container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
        }
        container.stateManager.dispatch({
          type: "OPEN_OVERLAY",
          overlay:
            action === "provider"
              ? {
                  type: "provider_picker",
                  currentProvider: state.provider,
                  isAnime: state.mode === "anime",
                }
              : action === "history"
                ? { type: "history" }
                : action === "notifications"
                  ? { type: "notifications" }
                  : action === "downloads"
                    ? { type: "downloads" }
                    : action === "settings" || action === "presence"
                      ? { type: "settings" }
                      : { type: action },
        });
        return;
      }
      if (action === "library" || action === "update" || action === "report-issue") {
        if (isRootMediaPickerOverlay(overlay) && overlay.id) {
          container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
        } else {
          container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
        }
        void import("./workflows").then(({ handleShellAction }) =>
          handleShellAction({ action, container }),
        );
      }
    },
  });

  useEffect(() => {
    setScrollIndex(0);
    setFilterQuery("");
    setSelectedIndex(
      overlay.type === "provider_picker"
        ? providerInitialIndex
        : overlay.type === "settings"
          ? nextSelectableIndex(
              buildSettingsOptions(container.config.getRaw(), container.presence.getSnapshot()),
              -1,
              1,
            )
          : overlayInitialIndex,
    );
    setTracksNav(createInitialTracksNav({ initialSectionIndex: tracksInitialSectionIndex }));
    setTracksFavorites(tracksFavoritesSnapshot);
    setAsyncLines(null);
    setLoadingAsyncLines(false);
    setSettingsDraft(overlay.type === "settings" ? container.config.getRaw() : null);
    setSettingsChoice(null);
    setSettingsParentIndex(0);
    setSettingsBusy(false);
    setSettingsError(null);
    setOverlayStatus(null);
    setNotificationActionDedupKey(null);
    setHistorySelections([]);
    setHistoryNextReleases(new Map());
    setHistoryProjections(new Map());
    setHistoryReleaseSignals(new Map());
    setHistoryTab(initialHistoryTab);
  }, [
    container.config,
    container.presence,
    overlay.type,
    overlayResetKey,
    overlayInitialIndex,
    tracksInitialSectionIndex,
    tracksFavoritesSnapshot,
    initialHistoryTab,
    providerInitialIndex,
  ]);

  useEffect(() => {
    if (overlay.type !== "history") return;
    setSelectedIndex(0);
  }, [historyTab, overlay.type]);

  useEffect(() => {
    if (overlay.type !== "history") {
      return;
    }

    let cancelled = false;
    setLoadingAsyncLines(true);

    void container.historyStore
      .getAll()
      .then((entries) => {
        if (cancelled) return undefined;
        const historyEntries = Object.entries(entries);
        setHistorySelections(
          historyEntries.map(([titleId, entry]) => ({
            titleId,
            entry,
          })),
        );
        const cachedProgress = container.releaseProgressCache.getByTitleIds(
          historyEntries.map(([titleId]) => titleId),
        );
        const nextReleases = readCachedHistoryNextReleases(historyEntries, cachedProgress);
        const projections = readCachedHistoryProjections(historyEntries, container, cachedProgress);
        const releaseSignals = readCachedHistoryReleaseSignals(historyEntries, cachedProgress);
        setAsyncLines(buildHistoryPanelLines(historyEntries));
        setHistoryNextReleases(nextReleases);
        setHistoryProjections(projections);
        setHistoryReleaseSignals(releaseSignals);
        enqueueReleaseReconciliation(
          container,
          historyEntries.map(([, entry]) => entry),
          "history",
        );
        return undefined;
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAsyncLines(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [container, container.historyStore, overlay.type]);

  useEffect(() => {
    if (!overlayStatus) return undefined;
    const timer = setTimeout(() => setOverlayStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [overlayStatus]);

  const runNotificationAction = (
    dedupKey: string | null | undefined,
    actionId?: NotificationActionId,
  ): void => {
    if (!dedupKey) return;
    const notification = notificationRecords.find((record) => record.dedupKey === dedupKey);
    if (!notification) return;
    const resolvedAction = actionId ?? getNotificationPrimaryAction(notification);
    const router = new NotificationActionRouter({
      playlist: container.queueService,
      mediaActions: new MediaActionRouter({
        queue: {
          enqueueMediaItem: (item, options) => {
            container.queueService.enqueueMediaItem(item, options);
          },
        },
      }),
      notifications: {
        dismiss: (key) => container.notificationService.dismiss(key),
      },
    });

    void (async () => {
      try {
        await router.run({
          notification,
          actionId: resolvedAction,
          playbackActive:
            state.playbackStatus === "loading" ||
            state.playbackStatus === "ready" ||
            state.playbackStatus === "buffering" ||
            state.playbackStatus === "seeking" ||
            state.playbackStatus === "stalled" ||
            state.playbackStatus === "playing",
        });
        setOverlayStatus(
          resolvedAction === "dismiss"
            ? "Notification dismissed"
            : resolvedAction === "restore-queue"
              ? "Queue restored"
              : "Action queued",
        );
        onRedraw();
      } catch (error) {
        setOverlayStatus(`Notification action failed: ${String(error)}`);
      }
    })();
  };

  useInput((input, key) => {
    if (commandMode) {
      return;
    }
    if (overlay.type === "tracks_panel") {
      // Nested two-pane: sections (left) ⇄ options (right). Selection resolves
      // through the picker bridge (RESOLVE/CANCEL_PICKER). See tracks-panel-nav.ts.
      const navCtx = {
        sectionCount: trackGroups.length,
        optionCount: trackGroups[tracksNav.sectionIndex]?.rows.length ?? 0,
      };
      const focusedGroup = trackGroups[tracksNav.sectionIndex];

      if (key.escape) {
        if (tracksNav.focusedPane === "options") {
          setTracksNav((nav) => tracksPanelNavReducer(nav, { type: "exit-section" }, navCtx));
          return;
        }
        container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
        container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
        return;
      }
      if (key.leftArrow && tracksNav.focusedPane === "options") {
        setTracksNav((nav) => tracksPanelNavReducer(nav, { type: "exit-section" }, navCtx));
        return;
      }
      if (key.rightArrow && tracksNav.focusedPane === "sections") {
        setTracksNav((nav) => tracksPanelNavReducer(nav, { type: "enter-section" }, navCtx));
        return;
      }
      if (key.upArrow || key.downArrow) {
        setTracksNav((nav) =>
          tracksPanelNavReducer(nav, { type: key.upArrow ? "up" : "down" }, navCtx),
        );
        return;
      }
      if (input === "f" && focusedGroup?.section === "source") {
        const sorted = sortByFavorites(focusedGroup.rows, tracksFavorites, (r) => r.label);
        const row = sorted[tracksNav.optionIndex];
        if (row) {
          const next = toggleFavoriteSource(tracksFavorites, row.label);
          setTracksFavorites(next);
          void container.config.update({ favoriteSources: next });
        }
        return;
      }
      if (key.return) {
        if (tracksNav.focusedPane === "sections") {
          setTracksNav((nav) => tracksPanelNavReducer(nav, { type: "enter-section" }, navCtx));
          return;
        }
        const sorted =
          focusedGroup?.section === "source"
            ? sortByFavorites(focusedGroup.rows, tracksFavorites, (r) => r.label)
            : (focusedGroup?.rows ?? []);
        const row = sorted[tracksNav.optionIndex];
        if (!focusedGroup || !row || !row.enabled) return; // facts never resolve
        container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
        container.stateManager.dispatch({
          type: "RESOLVE_PICKER",
          id: overlay.id,
          value: encodeTrackSelection(row.section, row.value),
        });
        return;
      }
      return;
    }
    if (key.escape) {
      if (overlay.type === "settings" && settingsChoice) {
        setSettingsChoice(null);
        setFilterQuery("");
        setSelectedIndex(settingsParentIndex);
        return;
      }
      if (overlay.type === "notifications" && notificationActionDedupKey) {
        setNotificationActionDedupKey(null);
        setFilterQuery("");
        setSelectedIndex(0);
        return;
      }
      if (isRootMediaPickerOverlay(overlay) && overlay.id) {
        if ((overlay.filterQuery ?? "").length > 0) {
          container.stateManager.dispatch({
            type: "UPDATE_PICKER_FILTER",
            id: overlay.id,
            filterQuery: "",
          });
          return;
        }
        container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
        return;
      }
      // Library / Downloads are self-contained shells that own Esc themselves
      // (clear an armed delete-confirm or switch sub-state first, then close via
      // their onClose). Let their own useInput handle it instead of closing here.
      if (overlay.type === "library" || overlay.type === "downloads") {
        return;
      }
      if (overlay.type === "history" && hasPendingRootHistorySelection()) {
        resolveRootHistorySelection(null);
      }
      container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
      return;
    }
    if (overlay.type === "history" && key.tab) {
      setHistoryTab((prev) => cycleHistoryTab(prev));
      return;
    }
    if (overlay.type === "history" && input.toLowerCase() === "q") {
      const picked = historyView.flatRows[selectedIndex]?.titleId ?? null;
      const selected = historySelections.find((entry) => entry.titleId === picked) ?? null;
      if (selected) {
        const historySelection = buildRootHistorySelection(
          selected,
          historyPickerContext.nextReleases,
          historyPickerContext.projections,
        );
        const queueEntry = historySelection.targetEpisode
          ? {
              ...historySelection.entry,
              season: historySelection.targetEpisode.season,
              episode: historySelection.targetEpisode.episode,
              positionSeconds:
                historySelection.targetEpisode.reason === "resume"
                  ? historySelection.entry.positionSeconds
                  : 0,
              completed:
                historySelection.targetEpisode.reason === "resume"
                  ? historySelection.entry.completed
                  : false,
            }
          : historySelection.entry;
        container.queueService.enqueueMediaItem(
          mediaItemFromHistoryEntry(historySelection.titleId, queueEntry),
          { placement: "end", source: "history" },
        );
        setOverlayStatus("Queued from history");
        onRedraw();
      }
      return;
    }
    if (overlay.type === "notifications" && input.toLowerCase() === "x") {
      if (notificationActionDedupKey) return;
      runNotificationAction(filteredNotificationOptions[selectedIndex]?.value, "dismiss");
      return;
    }
    if (overlay.type === "notifications" && input.toLowerCase() === "a") {
      const picked = filteredNotificationOptions[selectedIndex]?.value ?? null;
      if (picked) {
        setNotificationActionDedupKey(picked);
        setFilterQuery("");
        setSelectedIndex(0);
      }
      return;
    }
    if (key.return) {
      if (overlay.type === "settings") {
        const picked = filteredSettingsOptions[selectedIndex];
        if (!picked || !settingsDraft) {
          if (settingsChoice === "presenceDiscordClientId" && settingsDraft) {
            const typedClientId = filterQuery.trim();
            if (/^\d{12,32}$/.test(typedClientId)) {
              setSettingsDraft({ ...settingsDraft, presenceDiscordClientId: typedClientId });
              setSettingsChoice(null);
              setFilterQuery("");
              setSelectedIndex(settingsParentIndex);
              setSettingsError("Discord client id saved in draft. Press S to save settings.");
              return;
            }
            setSettingsError("Type a numeric Discord application client id, or Esc to cancel.");
          }
          if (settingsChoice === "downloadPath" && settingsDraft) {
            const typedPath = filterQuery.trim();
            if (typedPath.startsWith("/")) {
              setSettingsDraft({ ...settingsDraft, downloadPath: typedPath });
              setSettingsChoice(null);
              setFilterQuery("");
              setSelectedIndex(settingsParentIndex);
              setSettingsError("Download path saved in draft. Press S to save settings.");
              return;
            }
            setSettingsError("Type an absolute download path, or Esc to cancel.");
          }
          if (settingsChoice === "presenceDiscordOpenUrl" && settingsDraft) {
            const typedUrl = filterQuery.trim();
            if (isSafeDiscordOpenUrl(typedUrl)) {
              setSettingsDraft({ ...settingsDraft, presenceDiscordOpenUrl: typedUrl });
              setSettingsChoice(null);
              setFilterQuery("");
              setSelectedIndex(settingsParentIndex);
              setSettingsError("Discord open URL saved in draft. Press S to save settings.");
              return;
            }
            setSettingsError("Type a safe https:// or kunai:// URL, or Esc to cancel.");
          }
          if (settingsChoice === "videasySessionToken" && settingsDraft) {
            const typedToken = filterQuery.trim();
            if (isLikelyVideasySessionToken(typedToken)) {
              setSettingsDraft({ ...settingsDraft, videasySessionToken: typedToken });
              setSettingsChoice(null);
              setFilterQuery("");
              setSelectedIndex(settingsParentIndex);
              setSettingsError("Videasy session token saved in draft. Press S to save settings.");
              return;
            }
            setSettingsError("Type a Videasy session token, or Esc to cancel.");
          }
          return;
        }
        if (picked.value.startsWith("section:")) {
          return;
        }
        if (settingsChoice) {
          const next = { ...settingsDraft };
          if (settingsChoice === "defaultMode") {
            next.defaultMode = picked.value as "series" | "anime";
          } else if (settingsChoice === "provider") {
            next.provider = picked.value;
          } else if (settingsChoice === "animeProvider") {
            next.animeProvider = picked.value;
          } else if (settingsChoice === "animeAudio") {
            next.animeLanguageProfile = {
              ...next.animeLanguageProfile,
              audio: picked.value,
            };
          } else if (settingsChoice === "animeSubtitle") {
            next.animeLanguageProfile = {
              ...next.animeLanguageProfile,
              subtitle: picked.value,
            };
          } else if (settingsChoice === "seriesAudio") {
            next.seriesLanguageProfile = {
              ...next.seriesLanguageProfile,
              audio: picked.value,
            };
          } else if (settingsChoice === "seriesSubtitle") {
            next.seriesLanguageProfile = {
              ...next.seriesLanguageProfile,
              subtitle: picked.value,
            };
          } else if (settingsChoice === "movieAudio") {
            next.movieLanguageProfile = {
              ...next.movieLanguageProfile,
              audio: picked.value,
            };
          } else if (settingsChoice === "movieSubtitle") {
            next.movieLanguageProfile = {
              ...next.movieLanguageProfile,
              subtitle: picked.value,
            };
          } else if (settingsChoice === "animeTitlePreference") {
            next.animeTitlePreference = picked.value as typeof next.animeTitlePreference;
          } else if (settingsChoice === "footerHints") {
            next.footerHints = picked.value as "detailed" | "minimal";
          } else if (settingsChoice === "discoverMode") {
            next.discoverMode = picked.value as DiscoverMode;
          } else if (settingsChoice === "discoverItemLimit") {
            next.discoverItemLimit = Number(picked.value);
          } else if (settingsChoice === "autoDownload") {
            next.autoDownload = picked.value as AutoDownloadMode;
          } else if (settingsChoice === "recoveryMode") {
            next.recoveryMode = picked.value as RecoveryMode;
          } else if (settingsChoice === "startupPriority") {
            next.startupPriority = picked.value as StartupPriority;
          } else if (settingsChoice === "autoDownloadNextCount") {
            next.autoDownloadNextCount = Number(picked.value);
          } else if (settingsChoice === "autoCleanupGraceDays") {
            next.autoCleanupGraceDays = Number(picked.value);
          } else if (settingsChoice === "downloadPath") {
            const typedPath = filterQuery.trim();
            if (typedPath.startsWith("/")) {
              next.downloadPath = typedPath;
            } else if (picked.value === "__clear__") {
              next.downloadPath = "";
            } else if (picked.value === "__keep__") {
              // Keep the existing draft value.
            } else {
              setSettingsError("Type an absolute download path, or Esc to cancel.");
              return;
            }
          } else if (settingsChoice === "presenceProvider") {
            next.presenceProvider = picked.value as typeof next.presenceProvider;
          } else if (settingsChoice === "presencePrivacy") {
            next.presencePrivacy = picked.value as typeof next.presencePrivacy;
          } else if (settingsChoice === "presenceDiscordClientId") {
            const typedClientId = filterQuery.trim();
            if (/^\d{12,32}$/.test(typedClientId)) {
              next.presenceDiscordClientId = typedClientId;
            } else if (picked.value === "__clear__" || picked.value === "__env__") {
              next.presenceDiscordClientId = "";
            } else if (picked.value === "__keep__") {
              // Keep the existing draft value.
            } else {
              setSettingsError("Type a numeric Discord application client id, or Esc to cancel.");
              return;
            }
          } else if (settingsChoice === "presenceDiscordOpenUrl") {
            const typedUrl = filterQuery.trim();
            if (isSafeDiscordOpenUrl(typedUrl)) {
              next.presenceDiscordOpenUrl = typedUrl;
            } else if (picked.value === "__clear__") {
              next.presenceDiscordOpenUrl = "";
            } else if (picked.value === "__keep__") {
              // Keep the existing draft value.
            } else {
              setSettingsError("Type a safe https:// or kunai:// URL, or Esc to cancel.");
              return;
            }
          } else if (settingsChoice === "videasySessionToken") {
            const typedToken = filterQuery.trim();
            if (isLikelyVideasySessionToken(typedToken)) {
              next.videasySessionToken = typedToken;
            } else if (picked.value === "__clear__" || picked.value === "__env__") {
              next.videasySessionToken = "";
            } else if (picked.value === "__keep__") {
              // Keep the existing draft value.
            } else {
              setSettingsError("Type a Videasy session token, or Esc to cancel.");
              return;
            }
          } else if (settingsChoice === "videasyAppId") {
            next.videasyAppId = picked.value === "bc-frontend" ? "bc-frontend" : "vidking";
          } else if (settingsChoice === "quitNearEndBehavior") {
            next.quitNearEndBehavior = picked.value as QuitNearEndBehavior;
          } else if (settingsChoice === "quitNearEndThresholdMode") {
            next.quitNearEndThresholdMode = picked.value as QuitNearEndThresholdMode;
          }
          setSettingsDraft(next);
          setSettingsChoice(null);
          setFilterQuery("");
          setSelectedIndex(settingsParentIndex);
          setSettingsError(null);
          return;
        }
        if (picked.value === "showMemory") {
          setSettingsDraft({ ...settingsDraft, showMemory: !settingsDraft.showMemory });
          setSettingsError(null);
          return;
        }
        if (picked.value === "autoNext") {
          setSettingsDraft({ ...settingsDraft, autoNext: !settingsDraft.autoNext });
          setSettingsError(null);
          return;
        }
        if (picked.value === "discoverShowOnStartup") {
          setSettingsDraft({
            ...settingsDraft,
            discoverShowOnStartup: !settingsDraft.discoverShowOnStartup,
          });
          setSettingsError(null);
          return;
        }
        if (picked.value === "recommendationRailEnabled") {
          setSettingsDraft({
            ...settingsDraft,
            recommendationRailEnabled: !settingsDraft.recommendationRailEnabled,
          });
          setSettingsError(null);
          return;
        }
        if (picked.value === "downloadsEnabled") {
          setSettingsDraft({ ...settingsDraft, downloadsEnabled: !settingsDraft.downloadsEnabled });
          setSettingsError(null);
          return;
        }
        if (picked.value === "powerSaverMode") {
          setSettingsDraft({ ...settingsDraft, powerSaverMode: !settingsDraft.powerSaverMode });
          setSettingsError(null);
          return;
        }
        if (picked.value === "autoCleanupWatched") {
          setSettingsDraft({
            ...settingsDraft,
            autoCleanupWatched: !settingsDraft.autoCleanupWatched,
          });
          setSettingsError(null);
          return;
        }
        if (picked.value === "resumeStartChoicePrompt") {
          setSettingsDraft({
            ...settingsDraft,
            resumeStartChoicePrompt: !settingsDraft.resumeStartChoicePrompt,
          });
          setSettingsError(null);
          return;
        }
        if (picked.value === "skipRecap") {
          setSettingsDraft({ ...settingsDraft, skipRecap: !settingsDraft.skipRecap });
          setSettingsError(null);
          return;
        }
        if (picked.value === "skipIntro") {
          setSettingsDraft({ ...settingsDraft, skipIntro: !settingsDraft.skipIntro });
          setSettingsError(null);
          return;
        }
        if (picked.value === "skipCredits") {
          setSettingsDraft({ ...settingsDraft, skipCredits: !settingsDraft.skipCredits });
          setSettingsError(null);
          return;
        }
        if (picked.value === "skipPreview") {
          setSettingsDraft({ ...settingsDraft, skipPreview: !settingsDraft.skipPreview });
          setSettingsError(null);
          return;
        }
        if (picked.value === "presenceConnection") {
          if (settingsDraft.presenceProvider !== "discord") {
            setSettingsError("Set Presence to Discord first, then retry this action.");
            return;
          }
          const currentSnapshot = container.presence.getSnapshot();
          const shouldDisconnect = currentSnapshot.status === "ready";
          setSettingsBusy(true);
          setSettingsError(null);
          void (async () => {
            try {
              if (shouldDisconnect) {
                const snapshot = await container.presence.disconnect("settings-disconnect");
                setSettingsError(`Discord presence: ${snapshot.status}  ·  ${snapshot.detail}`);
              } else {
                const { applySettingsToRuntime } = await import("./workflows");
                await applySettingsToRuntime({
                  container,
                  next: settingsDraft,
                  previous: container.config.getRaw(),
                });
                const snapshot = await container.presence.connect();
                setSettingsDraft(container.config.getRaw());
                if (snapshot.status === "ready") {
                  setSettingsError(`Discord presence: ${snapshot.status}  ·  ${snapshot.detail}`);
                } else {
                  const errorDetail = getLatestPresenceErrorDetail(container);
                  setSettingsError(
                    errorDetail
                      ? `Discord presence: ${snapshot.status}  ·  ${snapshot.detail}  ·  ${errorDetail}`
                      : `Discord presence: ${snapshot.status}  ·  ${snapshot.detail}  ·  Make sure Discord desktop is running, then retry connect.`,
                  );
                }
              }
            } catch (error) {
              setSettingsError(
                `Failed to ${shouldDisconnect ? "disconnect" : "connect"} Discord presence: ${String(error)}`,
              );
            } finally {
              setSettingsBusy(false);
            }
          })();
          return;
        }
        if (picked.value === "clearCache") {
          void (async () => {
            const { handleShellAction } = await import("./workflows");
            await handleShellAction({ action: "clear-cache", container });
          })();
          return;
        }
        if (picked.value === "clearHistory") {
          void (async () => {
            const { handleShellAction } = await import("./workflows");
            await handleShellAction({ action: "clear-history", container });
          })();
          return;
        }
        if (picked.value === "presenceStatus") {
          setSettingsError(
            `Discord presence: ${container.presence.getSnapshot().status}  ·  ${container.presence.getSnapshot().detail}`,
          );
          return;
        }
        setSettingsChoice(picked.value as SettingsChoiceValue);
        setSettingsParentIndex(selectedIndex);
        setFilterQuery("");
        setSelectedIndex(0);
        setSettingsError(null);
        return;
      }
      if (overlay.type === "provider_picker") {
        const picked = filteredProviderOptions[selectedIndex]?.value;
        if (picked && picked !== state.provider) {
          const fromProviderId = state.provider;
          void (async () => {
            const { applyUserProviderSwitch } = await import("@/app/playback-provider-switch");
            await applyUserProviderSwitch({
              container,
              fromProviderId,
              toProviderId: picked,
              ...(state.currentTitle && state.currentEpisode
                ? {
                    title: state.currentTitle,
                    episode: state.currentEpisode,
                    mode: state.mode,
                  }
                : {}),
            });
            const next = container.stateManager.getState();
            const playbackActive =
              next.playbackStatus === "loading" ||
              next.playbackStatus === "ready" ||
              next.playbackStatus === "buffering" ||
              next.playbackStatus === "seeking" ||
              next.playbackStatus === "stalled" ||
              next.playbackStatus === "playing";
            if (playbackActive && next.currentEpisode) {
              void container.playerControl.recomputeCurrentPlayback("provider-picker-switch");
            }
          })();
        }
      } else if (overlay.type === "history") {
        const picked = historyView.flatRows[selectedIndex]?.titleId ?? null;
        const selected = historySelections.find((entry) => entry.titleId === picked) ?? null;
        resolveRootHistorySelection(
          selected
            ? buildRootHistorySelection(
                selected,
                historyPickerContext.nextReleases,
                historyPickerContext.projections,
              )
            : null,
        );
      } else if (overlay.type === "notifications") {
        if (notificationActionDedupKey) {
          const actionId = filteredNotificationActionOptions[selectedIndex]?.value;
          runNotificationAction(notificationActionDedupKey, actionId);
          setNotificationActionDedupKey(null);
          setFilterQuery("");
          setSelectedIndex(0);
        } else {
          const picked = filteredNotificationOptions[selectedIndex]?.value ?? null;
          runNotificationAction(picked);
        }
        return;
      } else if (
        overlay.type === "season_picker" ||
        overlay.type === "episode_picker" ||
        overlay.type === "subtitle_picker" ||
        overlay.type === "recommendation_picker"
      ) {
        const picked = filteredGenericPickerOptions[pickerSelectedIndex]?.value ?? null;
        if (!picked || !overlay.id) return;
        container.stateManager.dispatch({
          type: "RESOLVE_PICKER",
          id: overlay.id,
          value: picked,
        });
        return;
      }
      if (overlay.type === "downloads" || overlay.type === "library") {
        return;
      }
      container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
      return;
    }
    if (key.upArrow || key.downArrow) {
      if (isRootChoiceOverlay(overlay)) {
        if (isRootMediaPickerOverlay(overlay) && overlay.id) {
          container.stateManager.dispatch({
            type: "MOVE_PICKER_SELECTION",
            id: overlay.id,
            delta: key.upArrow ? -1 : 1,
          });
          return;
        }
        const optionCount =
          overlay.type === "provider_picker"
            ? filteredProviderOptions.length
            : overlay.type === "history"
              ? historyView.flatRows.length
              : overlay.type === "notifications"
                ? notificationActionDedupKey
                  ? filteredNotificationActionOptions.length
                  : filteredNotificationOptions.length
                : overlay.type === "settings"
                  ? filteredSettingsOptions.length
                  : filteredGenericPickerOptions.length;
        if (optionCount > 0) {
          if (overlay.type === "settings") {
            const delta = key.upArrow ? -1 : 1;
            setSelectedIndex((current) =>
              nextSelectableIndex(filteredSettingsOptions, current, delta),
            );
          } else {
            setSelectedIndex((current) =>
              key.upArrow ? (current - 1 + optionCount) % optionCount : (current + 1) % optionCount,
            );
          }
        }
      } else {
        if (key.upArrow) {
          setScrollIndex((current) => Math.max(0, current - 1));
        } else {
          setScrollIndex((current) => Math.min(Math.max(lines.length - maxLines, 0), current + 1));
        }
      }
      return;
    }
    if (isRootChoiceOverlay(overlay)) {
      if (overlay.type === "settings" && input === "\x13") {
        if (
          !settingsDraft ||
          settingsBusy ||
          settingsEqual(settingsDraft, container.config.getRaw())
        ) {
          return;
        }
        setSettingsBusy(true);
        setSettingsError(null);
        void (async () => {
          try {
            const { applySettingsToRuntime } = await import("./workflows");
            await applySettingsToRuntime({
              container,
              next: settingsDraft,
              previous: container.config.getRaw(),
            });
            container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
          } catch (error) {
            setSettingsBusy(false);
            setSettingsError(`Failed to save settings: ${String(error)}`);
          }
        })();
        return;
      }
      if (input === "/") {
        return;
      }
      if (filterEditor.handleInput(input, key)) {
        return;
      }
    }
  });

  const overlayPanel: BrowseOverlay =
    overlay.type === "provider_picker"
      ? {
          type: "provider",
          title,
          subtitle: effectiveSubtitle,
          options: filteredProviderOptions,
          filterQuery,
          selectedIndex: Math.min(selectedIndex, Math.max(filteredProviderOptions.length - 1, 0)),
          busy: false,
        }
      : overlay.type === "history"
        ? {
            type: "help",
            title,
            subtitle: effectiveSubtitle,
            lines: [],
            scrollIndex: 0,
          }
        : overlay.type === "notifications"
          ? {
              type: "history-picker",
              title,
              subtitle: notificationActionDedupKey
                ? "Choose an explicit action for this notice"
                : effectiveSubtitle,
              options: notificationActionDedupKey
                ? filteredNotificationActionOptions
                : filteredNotificationOptions,
              filterQuery,
              selectedIndex: Math.min(
                selectedIndex,
                Math.max(
                  (notificationActionDedupKey
                    ? filteredNotificationActionOptions
                    : filteredNotificationOptions
                  ).length - 1,
                  0,
                ),
              ),
              busy: false,
            }
          : overlay.type === "settings" && settingsPanel
            ? {
                ...settingsPanel,
                subtitle: effectiveSubtitle,
                options: filteredSettingsOptions,
                filterQuery,
                selectedIndex: Math.min(
                  selectedIndex,
                  Math.max(filteredSettingsOptions.length - 1, 0),
                ),
                busy: settingsBusy,
              }
            : overlay.type === "season_picker" ||
                overlay.type === "episode_picker" ||
                overlay.type === "subtitle_picker" ||
                overlay.type === "recommendation_picker"
              ? {
                  type: "episode-picker",
                  title,
                  subtitle: effectiveSubtitle,
                  options: filteredGenericPickerOptions,
                  filterQuery: pickerFilterQuery,
                  selectedIndex: Math.min(
                    pickerSelectedIndex,
                    Math.max(filteredGenericPickerOptions.length - 1, 0),
                  ),
                  busy: false,
                }
              : overlay.type === "help" ||
                  overlay.type === "about" ||
                  overlay.type === "diagnostics"
                ? {
                    type: overlay.type,
                    title,
                    subtitle: effectiveSubtitle,
                    lines,
                    scrollIndex,
                  }
                : {
                    type: "help",
                    title: "Help",
                    subtitle: "Global commands, editing, filtering, and shell behavior",
                    lines: buildHelpPanelLines(),
                    scrollIndex: 0,
                  };

  if (overlay.type === "downloads") {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
        <Box flexDirection="column" flexGrow={1}>
          <ContextStrip items={[{ label: "panel downloads", tone: "info" }]} />
          <DownloadManagerContent
            container={container}
            onClose={() => container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" })}
          />
        </Box>

        <Box flexDirection="column">
          {commandMode ? (
            <CommandPalette
              input={commandInput}
              cursor={commandCursor}
              commands={commands}
              highlightedIndex={highlightedIndex}
            />
          ) : null}
          <ShellFooter
            taskLabel="Download queue  ·  x cancel/remove, r retry, Esc closes"
            actions={footerActions}
            mode="detailed"
            commandMode={commandMode}
          />
        </Box>
      </Box>
    );
  }

  if (overlay.type === "library") {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
        <Box flexDirection="column" flexGrow={1}>
          <LibraryShell
            container={container}
            onClose={() => container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" })}
            initialView={overlay.view ?? "library"}
          />
        </Box>

        <Box flexDirection="column">
          {commandMode ? (
            <CommandPalette
              input={commandInput}
              cursor={commandCursor}
              commands={commands}
              highlightedIndex={highlightedIndex}
            />
          ) : null}
          <ShellFooter
            taskLabel="Library"
            actions={[
              { key: "↑↓", label: "select", action: "search" as const },
              { key: "enter", label: "open", action: "search" as const },
              { key: "d", label: "downloads", action: "search" as const },
              { key: "a", label: "auto", action: "search" as const },
              { key: "/", label: "commands", action: "command-mode" as const },
              { key: "esc", label: "close", action: "quit" as const },
            ]}
            mode="minimal"
            commandMode={commandMode}
          />
        </Box>
      </Box>
    );
  }

  if (overlay.type === "history") {
    const columns = stdout.columns ?? 80;
    const innerWidth = Math.max(24, columns - 8);
    const previewWidth = 32;
    const showRail = shouldRenderPreviewRail({ columns, hasModel: historyView.rail !== null });
    const listWidth = showRail ? Math.max(48, innerWidth - previewWidth - 4) : innerWidth;
    const rowWidth = Math.max(20, listWidth - 4);

    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
        <Box flexDirection="column" flexGrow={1}>
          <ContextStrip
            items={[
              { label: title, tone: "info" },
              {
                label: loadingAsyncLines
                  ? "loading history"
                  : `${historyView.flatRows.length} titles · ${historyView.tabLabels[historyView.tabIndex] ?? "All"}`,
                tone: "neutral",
              },
            ]}
          />
          <HistoryShell
            view={historyView}
            columns={columns}
            listWidth={listWidth}
            rowWidth={rowWidth}
          />
        </Box>

        <Box flexDirection="column">
          {commandMode ? (
            <CommandPalette
              input={commandInput}
              cursor={commandCursor}
              commands={commands}
              highlightedIndex={highlightedIndex}
            />
          ) : null}
          <ShellFooter
            taskLabel="History  ·  Enter resumes, q queues, Tab filters, type to narrow"
            actions={footerActions}
            mode="detailed"
            commandMode={commandMode}
          />
        </Box>
      </Box>
    );
  }

  if (overlay.type === "help") {
    return (
      <HelpShell
        commandMode={commandMode}
        commandInput={commandInput}
        commandCursor={commandCursor}
        commands={commands}
        highlightedIndex={highlightedIndex}
        footerActions={footerActions}
      />
    );
  }

  if (overlay.type === "tracks_panel") {
    const tracksHasSwitchable = trackGroups.some((group) => group.rows.some((row) => row.enabled));
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
        <Box flexDirection="column" flexGrow={1}>
          <ContextStrip
            items={[
              { label: title, tone: "info" },
              { label: effectiveSubtitle, tone: "neutral" },
            ]}
          />
          <TracksPanelShell
            groups={trackGroups}
            nav={tracksNav}
            favorites={tracksFavorites}
            width={Math.max(24, (stdout.columns ?? 80) - 8)}
            height={Math.max(8, (stdout.rows ?? 32) - 9)}
          />
        </Box>

        <Box flexDirection="column">
          {commandMode ? (
            <CommandPalette
              input={commandInput}
              cursor={commandCursor}
              commands={commands}
              highlightedIndex={highlightedIndex}
            />
          ) : null}
          <ShellFooter
            taskLabel={
              tracksHasSwitchable
                ? "Tracks  ·  ↑↓ choose, → enter, ⏎ switch, f favorite"
                : "Tracks  ·  facts only, Esc closes"
            }
            actions={
              tracksHasSwitchable
                ? [
                    { key: "↑↓", label: "choose", action: "details" as const },
                    { key: "→", label: "enter", action: "details" as const },
                    { key: "enter", label: "switch", action: "details" as const, primary: true },
                    { key: "f", label: "favorite", action: "details" as const },
                    { key: "esc", label: "close", action: "quit" as const },
                  ]
                : [
                    { key: "/", label: "commands", action: "command-mode" as const },
                    { key: "esc", label: "close", action: "quit" as const },
                  ]
            }
            mode="detailed"
            commandMode={commandMode}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <Box flexDirection="column" flexGrow={1}>
        <ContextStrip
          items={[
            {
              label: title,
              tone: "info",
            },
            {
              label:
                overlay.type === "provider_picker"
                  ? `${filteredProviderOptions.length} options`
                  : overlay.type === "notifications"
                    ? notificationActionDedupKey
                      ? `${filteredNotificationActionOptions.length} actions`
                      : `${filteredNotificationOptions.length} options`
                    : overlay.type === "settings"
                      ? `${filteredSettingsOptions.length} options`
                      : isRootMediaPickerOverlay(overlay)
                        ? `${filteredGenericPickerOptions.length} options`
                        : `${Math.min(scrollIndex + maxLines, lines.length)}/${lines.length} lines`,
            },
          ]}
        />
        <OverlayPanel
          overlay={overlayPanel}
          width={Math.max(24, (stdout.columns ?? 80) - 8)}
          maxLinesOverride={maxLines}
        />
      </Box>

      <Box flexDirection="column">
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            cursor={commandCursor}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}
        <ShellFooter
          taskLabel={
            overlay.type === "provider_picker"
              ? "Provider picker  ·  Type to filter, Enter to switch, Esc closes"
              : overlay.type === "notifications"
                ? notificationActionDedupKey
                  ? "Notification actions  ·  Enter runs, Esc returns"
                  : "Notifications  ·  Enter acts, a actions, x dismisses"
                : overlay.type === "settings"
                  ? settingsChoice
                    ? "Settings choice  ·  Type to filter, Enter to apply, Esc returns"
                    : "Settings  ·  Type to filter, Enter to edit, ^S saves, Esc closes"
                  : isRootMediaPickerOverlay(overlay)
                    ? title
                    : `${title}  ·  Esc closes and returns to the previous shell state`
          }
          actions={footerActions}
          mode="detailed"
          commandMode={commandMode}
        />
      </Box>
    </Box>
  );
}
