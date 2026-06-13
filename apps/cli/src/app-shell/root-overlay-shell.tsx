import { useLineEditor } from "@/app-shell/line-editor";
import {
  applyMediaItemSessionRouting,
  playbackIntentFromMediaItem,
} from "@/app/notification-media-session";
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
import { createContainerMediaActionRouter } from "@/services/media-actions/create-container-media-action-router";
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
import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveCommandContext, type ResolvedAppCommand } from "./commands";
import { DownloadManagerContent } from "./download-manager-shell";
import { HistoryShell } from "./history-shell";
import {
  buildHistoryView,
  cycleHistoryTab,
  cycleHistoryTypeFilter,
  historyTabFromLegacy,
  type HistoryTab,
  type HistoryTypeFilter,
} from "./history-view";
import { helpSections, type HelpSection } from "./keybindings";
import { getPickerChromeRows, getPickerLayout, getPickerListMaxVisible } from "./layout-policy";
import { LibraryShell } from "./library-shell";
import {
  buildNotificationActionOptions,
  buildNotificationPickerOptions,
  getNotificationPrimaryAction,
} from "./notification-overlay-model";
import {
  applyAnimeProviderOrder,
  applySeriesProviderOrder,
  buildSettingsChoiceOverlay,
  buildSettingsOptions,
  buildSettingsProviderOptions,
  buildSettingsSummary,
  type BrowseOverlay,
  moveProviderInOrder,
  OverlayPanel,
  resolveAnimeProviderOrder,
  resolveSeriesProviderOrder,
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
  sortProvidersByConfigPriority,
} from "./panel-data";
import {
  buildRootHistorySelection,
  hasPendingRootHistorySelection,
  resolveRootHistorySelection,
  releaseProgressToContinueHistoryRelease,
  type RootHistorySelection,
} from "./root-history-bridge";
import {
  stageNotificationDetailsItem,
  stageNotificationPlaybackIntent,
} from "./root-overlay-bridge";
import {
  buildRootGenericPickerOptions,
  getRootOverlayInitialIndex,
  getRootOverlaySubtitle,
  getRootOverlayTitle,
  isRootChoiceOverlay,
  isRootMediaPickerOverlay,
} from "./root-overlay-model";
import { type RootOwnedOverlay } from "./root-shell-state";
import { useShellInput } from "./shell-command-input";
import { CommandPalette } from "./shell-command-ui";
import { ContextStrip, ShellFooter } from "./shell-primitives";
import { palette } from "./shell-theme";
import {
  createInitialTracksNav,
  tracksPanelNavReducer,
  type TracksNavState,
} from "./tracks-panel-nav";
import { TracksPanelShell } from "./tracks-panel-shell";
import type { FooterAction, ShellPanelLine } from "./types";
import { useShellDimensions } from "./use-viewport-policy";

/** Stable empty favorites reference for non-tracks overlays (keeps effect deps referentially stable). */
const EMPTY_TRACKS_FAVORITES: readonly string[] = [];

const HELP_TABS_INTERNAL = helpSections().map((section) => section.group);
type HelpTab = (typeof HELP_TABS_INTERNAL)[number];

const HELP_SECTION_BY_GROUP = new Map<string, HelpSection>(
  helpSections().map((section) => [section.group, section]),
);

/**
 * Render rows for a given help tab. Exported for testability — the live
 * `HelpShell` calls this directly and the help-overlay test asserts the
 * overlay's content matches the registry.
 */
export function helpTabRows(tab: string): readonly { key: string; desc: string }[] {
  return (HELP_SECTION_BY_GROUP.get(tab)?.items ?? []).map((hint) => ({
    key: hint.keys,
    desc: hint.label,
  }));
}

/**
 * Ordered list of help tab groups. Mirrors `helpSections().map(s => s.group)`
 * but is captured at module load so the renderer doesn't re-derive it on
 * every render. Exported for testability.
 */
export const HELP_TABS: readonly string[] = HELP_TABS_INTERNAL;

/**
 * Test-only: build the live help tab rows from the same `helpTabRows`
 * helper the overlay uses. Lets the test assert the registry-driven
 * content without spinning up the full HelpShell component.
 */
export function buildHelpTabRows(tab: string): readonly { key: string; desc: string }[] {
  return helpTabRows(tab);
}

function HelpShell({
  commandMode,
  commandInput,
  commandCursor,
  commands,
  highlightedIndex,
  footerActions,
  onClose,
}: {
  commandMode: boolean;
  commandInput: string;
  commandCursor: number;
  commands: readonly ResolvedAppCommand[];
  highlightedIndex: number;
  footerActions: readonly FooterAction[];
  onClose: () => void;
}) {
  const initialTab = (HELP_TABS[0] ?? "Global") as HelpTab;
  const [activeTab, setActiveTab] = useState<HelpTab>(initialTab);

  useInput(
    (input, key) => {
      if (commandMode) return;
      if (key.tab) {
        setActiveTab((prev) => {
          const idx = HELP_TABS.indexOf(prev);
          const delta = key.shift ? -1 : 1;
          const next = HELP_TABS[(idx + delta + HELP_TABS.length) % HELP_TABS.length];
          return (next ?? HELP_TABS[0] ?? prev) as HelpTab;
        });
        return;
      }
      if (input === "?") {
        // The global `?` binding only fires "open help". When help is already
        // at the top, the same key should close it. Bail to Esc-style close
        // here so the user has a single, predictable toggle key.
        onClose();
      }
    },
    { isActive: !commandMode },
  );

  const rows = helpTabRows(activeTab);

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1}>
        <Text color={palette.text} bold>
          {"▸ Help"}
        </Text>
        <Text color={palette.dim}>{"Tab / Shift+Tab cycles sections · Esc or ? closes"}</Text>
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
          taskLabel={"Help  ·  Tab/Shift+Tab cycles sections, Esc or ? closes"}
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
      latestAiredEpisode: projection.latestAiredEpisode ?? null,
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
  const nextReadyCursors: Array<{ titleId: string; season: number; episode: number }> = [];
  for (const [titleId, entry] of entries) {
    if (historyContentType(entry) !== "series") continue;
    nextReadyCursors.push({
      titleId,
      season: entry.season ?? 1,
      episode: entry.episode ?? entry.absoluteEpisode ?? 1,
    });
  }
  const nextReadyAssets =
    container.offlineAssetService.listNextReadyByTitleCursors(nextReadyCursors);
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
  const { cols, rows } = useShellDimensions();
  const maxLines = getPickerListMaxVisible(
    rows,
    getPickerChromeRows({ hasSubtitle: false, commandMode: false, extraRows: 1 }),
  );
  const overlayInitialIndex = getRootOverlayInitialIndex(overlay);
  const rawConfig = container.config.getRaw();
  const providerOptions =
    overlay.type === "provider_picker"
      ? buildProviderPickerOptions({
          providers: sortProvidersByConfigPriority({
            providers: container.providerRegistry
              .getAll()
              .map((p) => p.metadata)
              .filter((metadata) => metadata.isAnimeProvider === overlay.isAnime),
            priority: overlay.isAnime
              ? [rawConfig.animeProvider, ...rawConfig.animeProviderPriority]
              : [rawConfig.provider, ...rawConfig.providerPriority],
          }),
          currentProvider: overlay.currentProvider,
          previewImageUrl: state.currentTitle?.posterUrl,
        })
      : [];
  const providerInitialIndex =
    overlay.type === "provider_picker"
      ? Math.max(
          0,
          providerOptions.findIndex((option) => option.value === overlay.currentProvider),
        )
      : 0;
  const tracksInitialSectionIndex =
    overlay.type === "tracks_panel"
      ? Math.max(
          0,
          overlay.groups.findIndex((group) => group.section === overlay.initialSection),
        )
      : 0;
  const initialHistoryTab =
    overlay.type === "history"
      ? historyTabFromLegacy(overlay.initialFilterMode ?? "all")
      : ("all" satisfies HistoryTab);
  const [scrollIndex, setScrollIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(() =>
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
  const [tracksNav, setTracksNav] = useState<TracksNavState>(() =>
    createInitialTracksNav({
      initialSectionIndex: tracksInitialSectionIndex,
      focusedPane:
        overlay.type === "tracks_panel" && overlay.initialSection ? "options" : "sections",
    }),
  );
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
  const [loadingAsyncLines, setLoadingAsyncLines] = useState(overlay.type === "history");
  const [settingsDraft, setSettingsDraft] = useState<KitsuneConfig | null>(() =>
    overlay.type === "settings" ? container.config.getRaw() : null,
  );
  // Persist settings the moment they change — no separate save step. Debounce so
  // rapid toggles coalesce; applySettingsToRuntime writes disk + syncs session state.
  useEffect(() => {
    if (!settingsDraft) return;
    if (settingsEqual(settingsDraft, container.config.getRaw())) return;

    const next = settingsDraft;
    const timer = setTimeout(() => {
      void (async () => {
        const previous = container.config.getRaw();
        if (settingsEqual(next, previous)) return;
        const { applySettingsToRuntime } = await import("@/app/apply-settings-to-runtime");
        await applySettingsToRuntime({ container, next, previous });
      })();
    }, 300);

    return () => clearTimeout(timer);
  }, [settingsDraft, container]);
  const [settingsChoice, setSettingsChoice] = useState<SettingsChoiceValue | null>(null);
  const [settingsParentIndex, setSettingsParentIndex] = useState(0);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [overlayStatus, setOverlayStatus] = useState<string | null>(null);
  const [notificationActionDedupKey, setNotificationActionDedupKey] = useState<string | null>(null);
  const [notificationPlayConfirm, setNotificationPlayConfirm] = useState<{
    readonly dedupKey: string;
    readonly actionId: NotificationActionId;
  } | null>(null);
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
  const [historyTab, setHistoryTab] = useState<HistoryTab>(initialHistoryTab);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<HistoryTypeFilter>("all");
  const reloadHistoryOverlay = useCallback(async () => {
    const entries = await container.historyStore.getAll();
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
    return historyEntries;
  }, [container]);
  const trackGroups = overlay.type === "tracks_panel" ? overlay.groups : [];
  const commands = resolveCommandContext(state, "rootOverlay");
  const historyPickerContext: HistoryPickerOptionsContext = {
    nextReleases: historyNextReleases,
    projections: historyProjections,
    releaseSignals: historyReleaseSignals,
  };
  const seriesProviderMetadata = sortProvidersByConfigPriority({
    providers: container.providerRegistry
      .getAll()
      .map((provider) => provider.metadata)
      .filter((metadata) => !metadata.isAnimeProvider),
    priority: [rawConfig.provider, ...rawConfig.providerPriority],
  });
  const animeProviderMetadata = sortProvidersByConfigPriority({
    providers: container.providerRegistry
      .getAll()
      .map((provider) => provider.metadata)
      .filter((metadata) => metadata.isAnimeProvider),
    priority: [rawConfig.animeProvider, ...rawConfig.animeProviderPriority],
  });
  const settingsSeriesProviderOptions = buildSettingsProviderOptions({
    providers: seriesProviderMetadata,
    currentProvider: settingsDraft?.provider ?? container.config.provider,
  });
  const settingsAnimeProviderOptions = buildSettingsProviderOptions({
    providers: animeProviderMetadata,
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
              releaseSummary: container.releaseProgressCache.summarizeActive(),
              releaseDiagnostics: container.releaseProgressCache.summarizeDiagnostics(),
              presenceSnapshot: container.presence.getSnapshot(),
              memorySamples: getRuntimeMemorySamples(),
            })
          : [];
  const lines = overlay.type === "history" ? (asyncLines ?? []) : staticLines;
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
        typeFilter: historyTypeFilter,
        filterQuery,
        selectedIndex,
        maxVisible: maxLines,
        narrow: cols < 124,
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
      historyTypeFilter,
      loadingAsyncLines,
      maxLines,
      overlay.type,
      selectedIndex,
      cols,
    ],
  );
  const notificationRecords =
    overlay.type === "notifications" ? container.notificationService.listActive() : [];
  const filteredNotificationOptions =
    overlay.type === "notifications"
      ? rankFuzzyMatches(
          buildNotificationPickerOptions(notificationRecords, {
            subActionsActive: notificationActionDedupKey !== null,
          }),
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
  const notificationPlayConfirmOptions = [
    {
      value: "confirm" as const,
      label: "Play now",
      detail: "Switch playback to this notice",
    },
    {
      value: "cancel" as const,
      label: "Cancel",
      detail: "Keep current playback",
    },
  ];
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
    (overlay.type === "notifications" ||
      overlay.type === "history" ||
      overlay.type === "tracks_panel") &&
    overlayStatus
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
        const nextOverlay =
          action === "provider"
            ? {
                type: "provider_picker" as const,
                currentProvider: state.provider,
                isAnime: state.mode === "anime",
              }
            : action === "history"
              ? { type: "history" as const }
              : action === "notifications"
                ? { type: "notifications" as const }
                : action === "downloads"
                  ? { type: "downloads" as const }
                  : action === "settings" || action === "presence"
                    ? { type: "settings" as const }
                    : { type: action };
        if (isRootMediaPickerOverlay(overlay) && overlay.id) {
          container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
          container.stateManager.dispatch({
            type: "OPEN_OVERLAY",
            overlay: nextOverlay,
          });
        } else {
          container.stateManager.dispatch({
            type: "REPLACE_TOP_OVERLAY",
            overlay: nextOverlay,
          });
        }
        return;
      }
      if (action === "library") {
        const nextOverlay = { type: "library" as const, view: "library" as const };
        if (isRootMediaPickerOverlay(overlay) && overlay.id) {
          container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
          container.stateManager.dispatch({ type: "OPEN_OVERLAY", overlay: nextOverlay });
        } else {
          container.stateManager.dispatch({ type: "REPLACE_TOP_OVERLAY", overlay: nextOverlay });
        }
        return;
      }
      if (action === "update" || action === "report-issue") {
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
    if (overlay.type !== "history") return;
    setSelectedIndex(0);
  }, [historyTab, overlay.type]);

  useEffect(() => {
    if (overlay.type !== "history") {
      return;
    }

    let cancelled = false;

    void reloadHistoryOverlay()
      .then((historyEntries) => {
        if (cancelled) return undefined;
        enqueueReleaseReconciliation(
          container,
          historyEntries.map(([, entry]) => entry),
          "history",
          undefined,
          {
            onComplete: async () => {
              if (!cancelled) await reloadHistoryOverlay();
            },
          },
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
  }, [container, overlay.type, reloadHistoryOverlay]);

  useEffect(() => {
    if (!overlayStatus) return undefined;
    const timer = setTimeout(() => setOverlayStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [overlayStatus]);

  const runNotificationAction = (
    dedupKey: string | null | undefined,
    actionId?: NotificationActionId,
    options?: { readonly confirmedContextSwitch?: boolean },
  ): void => {
    if (!dedupKey) return;
    const notification = notificationRecords.find((record) => record.dedupKey === dedupKey);
    if (!notification) return;
    const resolvedAction = actionId ?? getNotificationPrimaryAction(notification);
    const playbackActive =
      state.playbackStatus === "loading" ||
      state.playbackStatus === "ready" ||
      state.playbackStatus === "buffering" ||
      state.playbackStatus === "seeking" ||
      state.playbackStatus === "stalled" ||
      state.playbackStatus === "playing";

    if (
      resolvedAction === "play-now" &&
      playbackActive &&
      options?.confirmedContextSwitch !== true
    ) {
      setNotificationPlayConfirm({ dedupKey, actionId: resolvedAction });
      setNotificationActionDedupKey(null);
      return;
    }

    const router = new NotificationActionRouter({
      playlist: container.queueService,
      mediaActions: createContainerMediaActionRouter(container, {
        onDownloadQueued: (item) => {
          setOverlayStatus(`Queued download for ${item.title}`);
        },
        playback: {
          playNow: async (item) => {
            applyMediaItemSessionRouting(container, item);
            stageNotificationPlaybackIntent(playbackIntentFromMediaItem(item));
            await container.notificationService.dismiss(notification.dedupKey);
            container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
          },
        },
        details: {
          open: async (item) => {
            stageNotificationDetailsItem(item);
            container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
          },
        },
      }),
      notifications: {
        dismiss: (key) => container.notificationService.dismiss(key),
      },
    });

    void (async () => {
      try {
        setNotificationPlayConfirm(null);
        await router.run({
          notification,
          actionId: resolvedAction,
          playbackActive,
          confirmedContextSwitch: options?.confirmedContextSwitch,
        });
        setOverlayStatus(
          resolvedAction === "dismiss"
            ? "Notification dismissed"
            : resolvedAction === "restore-queue"
              ? "Queue restored"
              : resolvedAction === "download"
                ? "Download flow opened"
                : resolvedAction === "follow"
                  ? "Following releases"
                  : resolvedAction === "mute"
                    ? "Release notices muted"
                    : resolvedAction === "add-to-playlist"
                      ? "Saved to watchlist"
                      : resolvedAction === "play-now"
                        ? "Starting playback"
                        : resolvedAction === "open-details"
                          ? "Opening details"
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
    if (input === "?" && !key.ctrl && !key.meta) {
      // `?` is the global help toggle. The keybinding registry declares it
      // global but only ShellFrame wired it before — every root overlay
      // (history, settings, notifications, pickers) was missing it. Help has
      // its own `?` close handler; for non-help overlays we open it here.
      if (overlay.type === "help") {
        container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
        return;
      }
      container.stateManager.dispatch({
        type: "OPEN_OVERLAY",
        overlay: { type: "help" },
      });
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
      if (key.upArrow || key.downArrow || input === "j" || input === "k") {
        const down = key.downArrow || input === "j";
        setTracksNav((nav) => tracksPanelNavReducer(nav, { type: down ? "down" : "up" }, navCtx));
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
        if (!focusedGroup || !row) return;
        if (!row.enabled) {
          setOverlayStatus(
            row.reason ??
              (row.selected ? "Already on this stream" : "This option cannot be switched"),
          );
          return;
        }
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
      if (overlay.type === "notifications" && notificationPlayConfirm) {
        setNotificationPlayConfirm(null);
        setFilterQuery("");
        setSelectedIndex(0);
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
    if (overlay.type === "history" && key.tab && key.shift) {
      // Shift+Tab cycles the content-type axis (All/Anime/Series/Movies); plain
      // Tab cycles the bucket (Continue/Completed/New/All).
      setHistoryTypeFilter((prev) => cycleHistoryTypeFilter(prev));
      setSelectedIndex(0);
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
    if (
      overlay.type === "settings" &&
      settingsDraft &&
      (settingsChoice === "providerPriority" || settingsChoice === "animeProviderPriority")
    ) {
      const reorderDirection =
        input === "[" || (key.shift && key.upArrow)
          ? "up"
          : input === "]" || (key.shift && key.downArrow)
            ? "down"
            : null;
      if (reorderDirection) {
        const picked = filteredSettingsOptions[selectedIndex]?.value;
        if (!picked) return;
        const isAnime = settingsChoice === "animeProviderPriority";
        const order = isAnime
          ? resolveAnimeProviderOrder(settingsDraft)
          : resolveSeriesProviderOrder(settingsDraft);
        const moved = moveProviderInOrder(order, picked, reorderDirection);
        if (moved.join("|") !== order.join("|")) {
          setSettingsDraft(
            isAnime
              ? applyAnimeProviderOrder(settingsDraft, moved)
              : applySeriesProviderOrder(settingsDraft, moved),
          );
          setSettingsError(null);
        }
        return;
      }
      if (key.return) {
        return;
      }
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
                const { applySettingsToRuntime } = await import("@/app/apply-settings-to-runtime");
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
        if (notificationPlayConfirm) {
          const choice = notificationPlayConfirmOptions[selectedIndex]?.value ?? "cancel";
          if (choice === "confirm") {
            runNotificationAction(
              notificationPlayConfirm.dedupKey,
              notificationPlayConfirm.actionId,
              { confirmedContextSwitch: true },
            );
          } else {
            setNotificationPlayConfirm(null);
          }
          return;
        }
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
            const { applySettingsToRuntime } = await import("@/app/apply-settings-to-runtime");
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
              title: notificationPlayConfirm ? "Switch playback?" : title,
              subtitle: notificationPlayConfirm
                ? "Confirm play now — current playback will change"
                : notificationActionDedupKey
                  ? "Choose an explicit action for this notice"
                  : effectiveSubtitle,
              options: notificationPlayConfirm
                ? notificationPlayConfirmOptions
                : notificationActionDedupKey
                  ? filteredNotificationActionOptions
                  : filteredNotificationOptions,
              filterQuery: notificationPlayConfirm ? "" : filterQuery,
              selectedIndex: Math.min(
                selectedIndex,
                Math.max(
                  (notificationPlayConfirm
                    ? notificationPlayConfirmOptions
                    : notificationActionDedupKey
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
    const { innerWidth, listWidth: pickerListWidth, rowWidth } = getPickerLayout(cols, rows);
    const listWidth = pickerListWidth ?? innerWidth;

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
            columns={cols}
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
            terminalWidth={cols}
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
        onClose={() => container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" })}
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
            providerLabel={overlay.type === "tracks_panel" ? overlay.providerLabel : undefined}
            width={Math.max(24, cols - 8)}
            height={Math.max(8, rows - 9)}
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
            taskLabel="Tracks"
            actions={[
              { key: "↑↓", label: "choose", action: "details" as const },
              { key: "→", label: "enter", action: "details" as const },
              ...(tracksHasSwitchable
                ? [{ key: "enter", label: "switch", action: "details" as const, primary: true }]
                : []),
              { key: "f", label: "favorite", action: "details" as const },
              { key: "esc", label: "close", action: "quit" as const },
            ]}
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
          width={Math.max(24, cols - 8)}
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
                    : "Settings  ·  Type to filter, Enter to edit, saved automatically, Esc closes"
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
