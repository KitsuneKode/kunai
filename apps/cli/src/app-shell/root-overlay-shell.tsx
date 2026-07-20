import { useLineEditor } from "@/app-shell/line-editor";
import { buildQueueRestoreDeps, buildQueueRestoreStatus } from "@/app-shell/queue-restore";
import {
  applyMediaItemSessionRouting,
  playbackIntentFromMediaItem,
} from "@/app/playback/notification-media-session";
import { applyProviderPickerSelection } from "@/app/playback/playback-provider-switch";
import type { Container } from "@/container";
import type { HistoryReleaseSignal } from "@/domain/continuation/history-bucket";
import type { ContinueHistoryRelease } from "@/domain/continuation/history-reconciliation";
import { sortByFavorites, toggleFavoriteSource } from "@/domain/playback/source-name";
import { encodeTrackSelection } from "@/domain/playback/track-capabilities";
import {
  providerMetadataMatchesLane,
  providerPickerLanesForTitle,
  providerPriorityForLane,
  shellModeToProviderLane,
} from "@/domain/provider-lane";
import { resolveTitleLaneEligibility } from "@/domain/provider-lane-contract";
import { restoreQueueSessionWithResume } from "@/domain/queue/restore-queue-session";
import { rankFuzzyMatches } from "@/domain/session/fuzzy-match";
import { isPlaybackSessionActive, type SessionState } from "@/domain/session/SessionState";
import { openExternalUrlAndWait } from "@/infra/shell/open-external-url";
import { projectionFromViewDecision } from "@/services/continuation/continuation-policy";
import type { ContinueSourcePreference } from "@/services/continuation/continuation-source";
import { continuationSignalsForHistoryEntry } from "@/services/continuation/history-continuation-signals";
import {
  historyContentType,
  isFinished,
  readLatestHistoryByTitle,
} from "@/services/continuation/history-progress";
import { buildUiDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";
import { readCatalogBoundsForHistoryEntries } from "@/services/history-metadata/history-catalog-seed";
import { createContainerMediaActionRouter } from "@/services/media-actions/create-container-media-action-router";
import {
  NotificationActionRouter,
  type NotificationActionId,
} from "@/services/notifications/NotificationActionRouter";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";
import { appReleasePageUrl } from "@/services/update/release-url";
import { Box, Text, useInput } from "ink";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { requestBrowseIdleContextRefresh } from "./browse-idle-context";
import { cancelRootOverlay } from "./cancel-root-overlay";
import { resolveCommandContext, type ResolvedAppCommand } from "./commands";
import { buildDiagnosticsPanelInput, buildDiagnosticsSpanModel } from "./diagnostics-panel-source";
import {
  resolveDiagnosticsExpandedSpanIds,
  toggleDiagnosticsSpanExpanded,
} from "./diagnostics-panel.model";
import { PALETTE_WORKFLOW_ACTIONS } from "./dispatch-palette-command";
import { DownloadManagerContent } from "./download-manager-shell";
import { HistoryShell } from "./history-shell";
import {
  buildHistoryView,
  historyTabFromLegacy,
  type HistoryTab,
  type HistoryTypeFilter,
} from "./history-view";
import { routeOverlayInput } from "./input-router";
import { helpSections, helpSectionsForScope, type HelpSection, type KeyScope } from "./keybindings";
import {
  getOverlayContentViewport,
  getOverlayHostChromeRows,
  getOverlayListMaxVisible,
  getPickerLayout,
  resolveOverlayPanelKind,
} from "./layout-policy";
import { LibraryShell } from "./library-shell";
import { executeNotificationOverlayAction } from "./notification-action-flow";
import {
  buildNotificationActionOptions,
  buildNotificationPickerOptions,
  getNotificationPrimaryAction,
  getSelectedNotificationActionId,
  selectNotificationPickerOptions,
} from "./notification-overlay-model";
import { NotificationsShell } from "./notifications-shell";
import { buildNotificationsView, nearestNotificationDedupKey } from "./notifications-view";
import { resolveOverlayBackStack } from "./overlay-back-stack";
import {
  historyFooterActions,
  notificationsFooterActions,
  queueFooterActions,
} from "./overlay-footer-actions";
import {
  isOverlayCancelActive,
  shouldHandleOverlayEscape,
  shouldHistoryOverlayAcceptFilterInput,
} from "./overlay-input-safety";
import { OverlayLayoutProvider, type OverlayLayoutValue } from "./overlay-layout-context";
import { type BrowseOverlay, OverlayPanel } from "./overlay-panel";
import {
  buildAboutPanelLines,
  buildDiagnosticsPanelLines,
  buildHelpPanelLines,
  buildHistoryPanelLines,
  buildProviderPickerOptions,
  type HistoryPickerOptionsContext,
  sortProvidersByConfigPriority,
} from "./panel-data";
import { createQueuePosterResolver } from "./queue-poster-resolver";
import { QueueShell } from "./queue-shell";
import { buildQueueView } from "./queue-view";
import {
  resolveRootHistorySelection,
  releaseProgressToContinueHistoryRelease,
  type RootHistorySelection,
} from "./root-history-bridge";
import {
  clearNotificationPlaybackIntent,
  openDiagnosticsOverlay,
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
import { resolveRootQueueSelection } from "./root-queue-bridge";
import { resolveHelpScope, type RootOwnedOverlay } from "./root-shell-state";
import { runRootWorkflowSafely } from "./root-workflow-dispatch";
import { EPISODE_PICKER_SWITCH_SEASON } from "./session-picker";
import { SettingsShell } from "./settings/SettingsShell";
import { useShellInput } from "./shell-command-input";
import { CommandPalette } from "./shell-command-ui";
import { ContextStrip, ShellFooter, ViewportResizeGate } from "./shell-primitives";
import { palette } from "./shell-theme";
import {
  createInitialTracksNav,
  tracksPanelNavReducer,
  type TracksNavState,
} from "./tracks-panel-nav";
import { TracksPanelShell } from "./tracks-panel-shell";
import type { FooterAction, ShellPanelLine } from "./types";
import { handleHistoryOverlayInput, type HistoryDeletePending } from "./use-history-overlay-input";
import {
  createNotificationsOverlayState,
  handleNotificationsOverlayInput,
  type NotificationsOverlayState,
} from "./use-notifications-overlay-input";
import { useShellDimensions } from "./use-viewport-policy";

/** Stable empty favorites reference for non-tracks overlays (keeps effect deps referentially stable). */
const EMPTY_TRACKS_FAVORITES: readonly string[] = [];

const HELP_TABS_INTERNAL = helpSections().map((section) => section.group);

/** Human-readable scope labels for the help overlay header. */
const HELP_SCOPE_LABELS: Record<KeyScope, string> = {
  global: "global",
  editing: "editing",
  browse: "browse",
  search: "search",
  loading: "loading",
  library: "library",
  player: "playing",
  postPlayback: "post-play",
  queue: "queue",
  history: "history",
  notifications: "notifications",
};

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

function wrapOverlayLayout(layout: OverlayLayoutValue, node: ReactNode) {
  return (
    <OverlayLayoutProvider value={layout}>
      <ViewportResizeGate kind="picker" message="Resize terminal to use this panel">
        {node}
      </ViewportResizeGate>
    </OverlayLayoutProvider>
  );
}

/** Prefer the span header at scrollIndex; otherwise the nearest header above. */
function findDiagnosticsSpanIdNearScroll(
  lines: readonly { readonly spanId?: string }[],
  scrollIndex: number,
): string | null {
  if (lines.length === 0) return null;
  const start = Math.max(0, Math.min(scrollIndex, lines.length - 1));
  for (let i = start; i >= 0; i -= 1) {
    const spanId = lines[i]?.spanId;
    if (spanId) return spanId;
  }
  for (let i = start + 1; i < lines.length; i += 1) {
    const spanId = lines[i]?.spanId;
    if (spanId) return spanId;
  }
  return null;
}

function HelpShell({
  sections,
  scopeLabel,
  commandMode,
  commandInput,
  commandCursor,
  commands,
  highlightedIndex,
  footerActions,
  onClose,
}: {
  /** Scope-filtered help sections for the surface beneath the overlay. */
  sections: readonly HelpSection[];
  /** Human label for the active scope, shown in the header (e.g. "playing"). */
  scopeLabel: string;
  commandMode: boolean;
  commandInput: string;
  commandCursor: number;
  commands: readonly ResolvedAppCommand[];
  highlightedIndex: number;
  footerActions: readonly FooterAction[];
  onClose: () => void;
}) {
  const tabs = sections.length > 0 ? sections.map((section) => section.group) : HELP_TABS;
  const sectionByGroup = useMemo(
    () => new Map(sections.map((section) => [section.group, section])),
    [sections],
  );
  const [activeTab, setActiveTab] = useState<string>(tabs[0] ?? "Global");
  // Scope can change while the overlay is open (playback starts/ends); keep the
  // active tab valid instead of rendering an empty body.
  const safeActiveTab = tabs.includes(activeTab) ? activeTab : (tabs[0] ?? "Global");

  useInput(
    (input, key) => {
      if (commandMode) return;
      if (key.tab) {
        setActiveTab((prev) => {
          const idx = tabs.indexOf(prev);
          const delta = key.shift ? -1 : 1;
          const next = tabs[(idx + delta + tabs.length) % tabs.length];
          return next ?? tabs[0] ?? prev;
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

  const rows = (sectionByGroup.get(safeActiveTab)?.items ?? []).map((hint) => ({
    key: hint.keys,
    desc: hint.label,
  }));
  // Dense reference card: split the active section's rows into two balanced
  // columns so a long surface (player/postPlayback) reads without scrolling.
  const half = Math.ceil(rows.length / 2);
  const leftRows = rows.slice(0, half);
  const rightRows = rows.slice(half);
  const keyColWidth = Math.max(8, ...rows.map((row) => row.key.length));
  const renderColumn = (columnRows: typeof rows, side: "left" | "right") => (
    <Box flexDirection="column" flexGrow={1} marginRight={side === "left" ? 2 : 0}>
      {columnRows.map((row) => (
        <Box key={row.key} flexDirection="row" marginBottom={0} flexWrap="nowrap">
          <Text color={palette.accent}>{row.key.padEnd(keyColWidth)}</Text>
          <Text color={palette.textDim}> {row.desc}</Text>
        </Box>
      ))}
    </Box>
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Box flexDirection="row" flexWrap="nowrap">
          <Text color={palette.accent} bold>
            {"❀ Help"}
          </Text>
          <Text color={palette.muted}>{`  ·  ${scopeLabel}`}</Text>
        </Box>
        <Text color={palette.dim}>{"Tab / Shift+Tab cycles sections · Esc or ? closes"}</Text>
        {/* Tab strip */}
        <Box flexDirection="row" marginTop={1} marginBottom={0} flexWrap="wrap">
          {tabs.map((tab) => (
            <Box key={tab} marginRight={3} flexDirection="column">
              <Text color={safeActiveTab === tab ? palette.accent : palette.dim}>{tab}</Text>
              {safeActiveTab === tab ? (
                <Text color={palette.accent}>{"─".repeat(tab.length)}</Text>
              ) : null}
            </Box>
          ))}
        </Box>
        {/* Tab content — two dense columns */}
        <Box flexDirection="row" marginTop={1}>
          {renderColumn(leftRows, "left")}
          {rightRows.length > 0 ? renderColumn(rightRows, "right") : null}
        </Box>
      </Box>
      {commandMode ? (
        <CommandPalette
          input={commandInput}
          cursor={commandCursor}
          commands={commands}
          highlightedIndex={highlightedIndex}
        />
      ) : null}
      <ShellFooter
        taskLabel="Tab/Shift+Tab sections · Esc or ? closes"
        actions={footerActions}
        mode="detailed"
        commandMode={commandMode}
      />
    </Box>
  );
}

function readCachedHistoryNextReleases(
  entries: ReadonlyArray<[string, RootHistorySelection["entry"]]>,
  cachedProgress: ReadonlyMap<
    string,
    import("@/services/storage/storage-read-models").ReleaseProgressProjection
  >,
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
  cachedProgress: ReadonlyMap<
    string,
    import("@/services/storage/storage-read-models").ReleaseProgressProjection
  >,
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
  cachedProgress: ReadonlyMap<
    string,
    import("@/services/storage/storage-read-models").ReleaseProgressProjection
  >,
  catalogBounds: ReadonlyMap<
    string,
    import("@/domain/continuation/catalog-episode-bounds").CatalogEpisodeBounds
  >,
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
    const offline =
      policy || nextReadyByTitle.has(titleId)
        ? {
            enrolled: policy?.enrolled === true,
            readyNextEpisodes: (() => {
              const nextReady = nextReadyByTitle.get(titleId);
              return nextReady ? [nextReady] : [];
            })(),
          }
        : null;
    projections.set(
      titleId,
      projectionFromViewDecision(
        container.continueWatchingService.titleDecision(
          titleId,
          continuationSignalsForHistoryEntry({
            titleId,
            entry,
            nextRelease,
            releaseProgress,
            offline,
            catalogBounds: catalogBounds.get(titleId) ?? null,
          }),
        ),
      ),
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
  const overlayInitialIndex = getRootOverlayInitialIndex(overlay);
  const rawConfig = container.config.getRaw();
  const providerOptions = useMemo(() => {
    if (overlay.type !== "provider_picker") return [];
    // Dual-lane: a linked title (e.g. anime with a TMDB id) can also use the
    // other lane's providers; the resolve adapter maps kind/episode.
    const pickerLanes = providerPickerLanesForTitle(
      overlay.lane,
      state.currentTitle ? resolveTitleLaneEligibility(state.currentTitle) : null,
    );
    return buildProviderPickerOptions({
      providers: sortProvidersByConfigPriority({
        providers: container.providerRegistry
          .getAll()
          .map((p) => p.metadata)
          .filter((metadata) =>
            pickerLanes.some((lane) => providerMetadataMatchesLane(metadata, lane)),
          ),
        priority: providerPriorityForLane(rawConfig, overlay.lane),
      }),
      currentProvider: overlay.currentProvider,
      previewImageUrl: state.currentTitle?.posterUrl,
      getProviderHealth: (providerId) => container.providerHealth.get(providerId),
      isCrossLane: (metadata) => !providerMetadataMatchesLane(metadata, overlay.lane),
    });
  }, [
    overlay,
    container.providerRegistry,
    container.providerHealth,
    rawConfig,
    state.currentTitle,
  ]);
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
  /** null = use newest-span-expanded defaults from the view model */
  const [diagnosticsExpandedSpanIds, setDiagnosticsExpandedSpanIds] =
    useState<ReadonlySet<string> | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(() =>
    overlay.type === "provider_picker" ? providerInitialIndex : overlayInitialIndex,
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
      setSelectedIndex(0);
    },
    onRedraw,
  });
  const [asyncLines, setAsyncLines] = useState<readonly ShellPanelLine[] | null>(null);
  const [loadingAsyncLines, setLoadingAsyncLines] = useState(overlay.type === "history");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [overlayStatus, setOverlayStatus] = useState<string | null>(null);
  const [overlayClosePending, setOverlayClosePending] = useState(false);
  const [notificationActionDedupKey, setNotificationActionDedupKey] = useState<string | null>(null);
  const [notificationPlayConfirm, setNotificationPlayConfirm] = useState<{
    readonly dedupKey: string;
    readonly actionId: NotificationActionId;
  } | null>(null);
  const [historySourceChoiceTitleId, setHistorySourceChoiceTitleId] = useState<string | null>(null);
  const [historyPendingDelete, setHistoryPendingDelete] = useState<HistoryDeletePending | null>(
    null,
  );
  const [notificationsState, setNotificationsState] = useState<NotificationsOverlayState>(
    createNotificationsOverlayState,
  );
  const subscribeNotifications = useCallback(
    (listener: () => void) => container.notificationService.subscribe(listener),
    [container.notificationService],
  );
  const getNotificationRevision = useCallback(
    () => container.notificationService.getRevision(),
    [container.notificationService],
  );
  const notificationRevision = useSyncExternalStore(
    subscribeNotifications,
    getNotificationRevision,
    getNotificationRevision,
  );
  const subscribeDiagnostics = useCallback(
    (listener: () => void) => container.diagnosticsService.subscribe(listener),
    [container.diagnosticsService],
  );
  const getDiagnosticsRevision = useCallback(
    () => container.diagnosticsService.getRevision(),
    [container.diagnosticsService],
  );
  const diagnosticsRevision = useSyncExternalStore(
    subscribeDiagnostics,
    getDiagnosticsRevision,
    getDiagnosticsRevision,
  );
  useEffect(() => {
    if (overlay.type === "diagnostics") {
      setDiagnosticsExpandedSpanIds(null);
      setScrollIndex(0);
    }
  }, [overlay.type]);
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
  const [historyCatalogBounds, setHistoryCatalogBounds] = useState<
    NonNullable<HistoryPickerOptionsContext["catalogBounds"]>
  >(new Map());
  const [historyTab, setHistoryTab] = useState<HistoryTab>(initialHistoryTab);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<HistoryTypeFilter>("all");
  const reloadHistoryOverlay = useCallback(async () => {
    const entries = readLatestHistoryByTitle(container.historyRepository);
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
    const catalogBounds = readCatalogBoundsForHistoryEntries(
      historyEntries,
      cachedProgress,
      container.historyCatalogEpisodeCounts,
    );
    const nextReleases = readCachedHistoryNextReleases(historyEntries, cachedProgress);
    const projections = readCachedHistoryProjections(
      historyEntries,
      container,
      cachedProgress,
      catalogBounds,
    );
    const releaseSignals = readCachedHistoryReleaseSignals(historyEntries, cachedProgress);
    setAsyncLines(buildHistoryPanelLines(historyEntries));
    setHistoryNextReleases(nextReleases);
    setHistoryProjections(projections);
    setHistoryReleaseSignals(releaseSignals);
    setHistoryCatalogBounds(catalogBounds);
    return historyEntries;
  }, [container]);
  const onHistoryMutated = useCallback(() => {
    void reloadHistoryOverlay().then((entries) => {
      setSelectedIndex((current) =>
        entries.length === 0 ? 0 : Math.min(current, entries.length - 1),
      );
      onRedraw();
    });
    requestBrowseIdleContextRefresh();
  }, [onRedraw, reloadHistoryOverlay]);
  const trackGroups = overlay.type === "tracks_panel" ? overlay.groups : [];
  const commands = resolveCommandContext(state, "rootOverlay");
  const historyPickerContext: HistoryPickerOptionsContext = {
    nextReleases: historyNextReleases,
    projections: historyProjections,
    releaseSignals: historyReleaseSignals,
    catalogBounds: historyCatalogBounds,
  };
  const continueSourcePreference: ContinueSourcePreference =
    rawConfig.continueSourcePreference ?? "auto";
  // Diagnostics lines are memoized on service revision so arrow-key scrolling
  // never rebuilds the span model / insight on every keystroke.
  const diagnosticsLines = useMemo(() => {
    void diagnosticsRevision;
    if (overlay.type !== "diagnostics") return [];
    return buildDiagnosticsPanelLines(
      buildDiagnosticsPanelInput(container, {
        expandedSpanIds: diagnosticsExpandedSpanIds,
      }),
    );
  }, [container, diagnosticsExpandedSpanIds, diagnosticsRevision, overlay.type]);
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
          ? diagnosticsLines
          : [];
  const lines = overlay.type === "history" ? (asyncLines ?? []) : staticLines;
  const genericPickerOptions = useMemo(
    () =>
      overlay.type === "season_picker" ||
      overlay.type === "episode_picker" ||
      overlay.type === "subtitle_picker" ||
      overlay.type === "recommendation_picker"
        ? buildRootGenericPickerOptions(overlay)
        : [],
    [overlay],
  );
  const filteredProviderOptions = useMemo(
    () =>
      rankFuzzyMatches(providerOptions, filterQuery, (option) => [
        { value: option.label, weight: 0 },
        { value: option.detail, weight: 8 },
      ]),
    [providerOptions, filterQuery],
  );
  const filteredGenericPickerOptions = useMemo(
    () =>
      rankFuzzyMatches(genericPickerOptions, pickerFilterQuery, (option) => [
        { value: option.label, weight: 0 },
        { value: option.detail, weight: 8 },
        { value: option.badge, weight: 12 },
      ]),
    [genericPickerOptions, pickerFilterQuery],
  );
  // Up Next queue: bumping the tick after a mutation (reorder/remove/clear/restore)
  // recomputes the view from the service's fresh getAll().
  const [queueTick, setQueueTick] = useState(0);
  const queuePosterResolver = useMemo(() => {
    const map = new Map<string, string>();
    for (const { titleId, entry } of historySelections) {
      if (entry.posterUrl) map.set(titleId, entry.posterUrl);
    }
    return createQueuePosterResolver({ getPosterUrl: (id) => map.get(id) });
  }, [historySelections]);
  const queueView = useMemo(
    () =>
      buildQueueView({
        entries: overlay.type === "queue" ? container.queueService.getAll() : [],
        selectedId: null,
        resolvePoster: queuePosterResolver,
        recoverableSessions:
          overlay.type === "queue" ? container.queueService.listRecoverableSessions().length : 0,
        stale: overlay.type === "queue" ? container.queueService.getStatus().isStale : false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queueTick forces a fresh service read after mutations
    [overlay.type, queueTick, queuePosterResolver, container.queueService],
  );
  const title = getRootOverlayTitle(overlay, state);
  const subtitle = getRootOverlaySubtitle({
    overlay,
    state,
    settingsDraft: null,
    config: container.config.getRaw(),
    settingsError: null,
  });
  const effectiveSubtitle =
    (overlay.type === "notifications" ||
      overlay.type === "history" ||
      overlay.type === "tracks_panel" ||
      overlay.type === "diagnostics") &&
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
    ...(overlay.type === "diagnostics"
      ? ([{ key: "e", label: "export bundle", primary: true }] satisfies readonly FooterAction[])
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
        action === "continue" ||
        action === "history" ||
        action === "provider"
      ) {
        if (action === "notifications" && !container.featureFlags.attentionInbox) {
          container.stateManager.dispatch({
            type: "SET_PLAYBACK_FEEDBACK",
            note: "Attention inbox is disabled.",
          });
          return;
        }
        if (action === "diagnostics") {
          if (isRootMediaPickerOverlay(overlay) && overlay.id) {
            container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
          }
          void openDiagnosticsOverlay(container, "diagnostics-overlay-command");
          return;
        }
        const nextOverlay =
          action === "provider"
            ? {
                type: "provider_picker" as const,
                currentProvider: state.provider,
                lane: shellModeToProviderLane(state.mode),
              }
            : action === "history" || action === "continue"
              ? { type: "history" as const, initialFilterMode: "watching" as const }
              : action === "notifications"
                ? { type: "notifications" as const }
                : action === "downloads"
                  ? { type: "downloads" as const }
                  : action === "settings" || action === "presence"
                    ? { type: "settings" as const }
                    : { type: action };
        if (isRootMediaPickerOverlay(overlay) && overlay.id) {
          container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
        }
        container.stateManager.dispatch({
          type: "OPEN_OVERLAY",
          overlay: nextOverlay,
        });
        return;
      }
      if (action === "library") {
        const nextOverlay = { type: "library" as const, view: "library" as const };
        if (isRootMediaPickerOverlay(overlay) && overlay.id) {
          container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
        }
        container.stateManager.dispatch({ type: "OPEN_OVERLAY", overlay: nextOverlay });
        return;
      }
      if (PALETTE_WORKFLOW_ACTIONS.has(action)) {
        void runRootWorkflowSafely({
          container,
          action,
          cancelPickerId: isRootMediaPickerOverlay(overlay) && overlay.id ? overlay.id : undefined,
        });
      }
    },
  });

  const overlayPanelKind = resolveOverlayPanelKind(overlay.type);
  const overlayDedicatedShell =
    overlay.type === "history" || overlay.type === "queue" || overlay.type === "downloads";
  const overlayHostChromeRows = getOverlayHostChromeRows({
    commandMode,
    dedicatedShell: overlayDedicatedShell,
  });
  const overlayLayout = useMemo((): OverlayLayoutValue => {
    const viewport = getOverlayContentViewport({
      terminalRows: rows,
      terminalCols: cols,
      overlayChromeRows: overlayHostChromeRows,
      commandMode,
    });
    const listMaxVisible = getOverlayListMaxVisible({
      terminalRows: rows,
      terminalCols: cols,
      overlayChromeRows: overlayHostChromeRows,
      panelKind: overlayPanelKind,
      commandMode,
    });
    return {
      contentRows: viewport.contentRows,
      contentColumns: viewport.contentColumns,
      chromeRows: viewport.chromeRows,
      listMaxVisible,
    };
  }, [cols, rows, commandMode, overlayHostChromeRows, overlayPanelKind]);
  const maxLines = overlayLayout.listMaxVisible;
  const notifPageSize = overlayLayout.listMaxVisible;
  const historyView = useMemo(
    () =>
      buildHistoryView({
        entries: historySelections.map(({ titleId, entry }) => [titleId, entry] as const),
        tab: historyTab,
        typeFilter: historyTypeFilter,
        filterQuery,
        selectedIndex,
        maxVisible: maxLines,
        narrow: overlayLayout.contentColumns < 124,
        context: {
          nextReleases: historyNextReleases,
          projections: historyProjections,
          releaseSignals: historyReleaseSignals,
        },
        loading: overlay.type === "history" ? loadingAsyncLines : false,
        error: overlay.type === "history" ? historyError : null,
      }),
    [
      filterQuery,
      historyError,
      historyNextReleases,
      historyProjections,
      historyReleaseSignals,
      historySelections,
      historyTab,
      historyTypeFilter,
      loadingAsyncLines,
      maxLines,
      overlay.type,
      overlayLayout.contentColumns,
      selectedIndex,
    ],
  );
  // Service revision changes invalidate the durable snapshot; selection-only renders
  // reuse it so synchronous SQLite reads stay out of the keyboard-navigation hot path.
  const notificationRecordsAll = useMemo(() => {
    void notificationRevision;
    return overlay.type === "notifications"
      ? notificationsState.tab === "active"
        ? container.notificationService.listAllActive()
        : container.notificationService.listAllArchived()
      : [];
  }, [container.notificationService, notificationRevision, notificationsState.tab, overlay.type]);
  const notificationsView = buildNotificationsView({
    records: notificationRecordsAll,
    tab: notificationsState.tab,
    sortMode: notificationsState.sortByTab[notificationsState.tab],
    page: notificationsState.page,
    pageSize: notifPageSize,
    selectedDedupKey: notificationsState.selectedDedupKey,
    now: new Date().toISOString(),
    resolvePosterUrl: (titleId) => {
      for (const { titleId: id, entry } of historySelections) {
        if (id === titleId && entry.posterUrl) return entry.posterUrl;
      }
      return container.historyRepository.getLatestForTitle(titleId)?.posterUrl;
    },
  });
  const notificationUnreadCount = useMemo(() => {
    void notificationRevision;
    return overlay.type === "notifications" ? container.notificationService.countUnread() : 0;
  }, [container.notificationService, notificationRevision, overlay.type]);
  const notificationRecordsByKey = new Map(
    notificationRecordsAll.map((record) => [record.dedupKey, record] as const),
  );
  const notificationRecords = notificationsView.rows.flatMap((row) => {
    const record = notificationRecordsByKey.get(row.dedupKey);
    return record ? [record] : [];
  });
  const filteredNotificationOptions =
    overlay.type === "notifications"
      ? buildNotificationPickerOptions(notificationRecords, {
          subActionsActive: notificationActionDedupKey !== null,
        })
      : [];
  const selectedNotificationForActions =
    overlay.type === "notifications" && notificationActionDedupKey
      ? (notificationRecordsAll.find((record) => record.dedupKey === notificationActionDedupKey) ??
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
  const activeNotificationPickerOptions = selectNotificationPickerOptions({
    confirmationActive: notificationPlayConfirm !== null,
    actionPickerActive: notificationActionDedupKey !== null,
    inbox: filteredNotificationOptions,
    actions: filteredNotificationActionOptions,
    confirmation: notificationPlayConfirmOptions,
  });

  useEffect(() => {
    if (overlay.type !== "history") return;
    setSelectedIndex(0);
    setHistoryPendingDelete(null);
  }, [historyTab, overlay.type]);

  // Discard any play-now intent left staged by an earlier inbox session.
  // Only the palette route consumes the intent (it reads after close), so an
  // inbox opened by direct dispatch can strand one; without this it would fire
  // against the next palette-opened session and play the wrong title.
  useEffect(() => {
    if (overlay.type !== "notifications") return;
    clearNotificationPlaybackIntent();
  }, [overlay.type]);

  useEffect(() => {
    if (overlay.type !== "history") {
      return;
    }

    let cancelled = false;
    setHistoryError(null);
    setLoadingAsyncLines(true);

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
      .catch((error: unknown) => {
        if (!cancelled) {
          setHistoryError(error instanceof Error ? error.message : String(error));
        }
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
    // Resolve against the complete dataset — the target may live off the visible page.
    const notification = notificationRecordsAll.find((record) => record.dedupKey === dedupKey);
    if (!notification) return;
    const resolvedAction = actionId ?? getNotificationPrimaryAction(notification);
    const playbackActive = isPlaybackSessionActive(state.playbackStatus);

    // Pin identity before execution so the refreshed view stays on this notice
    // even when a mark-read re-sorts it under the Attention ordering.
    setNotificationsState((current) => ({ ...current, selectedDedupKey: dedupKey }));

    const router = new NotificationActionRouter({
      playlist: {
        // Restore through the shared path so a notification-driven restore gets
        // the same resume head as the overlay's `r` key.
        restoreRecoverableSession: (sessionId) =>
          restoreQueueSessionWithResume(buildQueueRestoreDeps(container), sessionId).restoredCount,
      },
      mediaActions: createContainerMediaActionRouter(container, {
        onDownloadQueued: (item) => {
          setOverlayStatus(`Queued download for ${item.title}`);
        },
        playback: {
          playNow: async (item) => {
            applyMediaItemSessionRouting(container, item);
            stageNotificationPlaybackIntent(playbackIntentFromMediaItem(item));
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
      appUpdate: {
        openReleasePage: (latestVersion) =>
          openExternalUrlAndWait(appReleasePageUrl(latestVersion)),
      },
      notifications: {
        dismiss: (key) => container.notificationService.archive(key),
      },
    });

    void (async () => {
      try {
        setNotificationPlayConfirm(null);
        const result = await executeNotificationOverlayAction({
          router,
          notification,
          actionId: resolvedAction,
          playbackActive,
          confirmedContextSwitch: options?.confirmedContextSwitch,
          markRead: (key) => container.notificationService.markRead(key),
        });
        if (result.status === "confirmation-required") {
          setNotificationPlayConfirm({ dedupKey, actionId: resolvedAction });
          setNotificationActionDedupKey(null);
          return;
        }
        if (result.status === "unsupported") {
          setOverlayStatus(`Action unavailable: ${result.reason}`);
          return;
        }
        if (resolvedAction === "dismiss" && notificationsState.tab === "active") {
          const nearest = nearestNotificationDedupKey(notificationsView.orderedDedupKeys, dedupKey);
          setNotificationsState((current) => ({ ...current, selectedDedupKey: nearest }));
        }
        const actionStatus =
          resolvedAction === "dismiss"
            ? "Notification dismissed"
            : resolvedAction === "restore-queue"
              ? "Queue restored"
              : resolvedAction === "download" || resolvedAction === "retry-download"
                ? "Download queued"
                : resolvedAction === "follow"
                  ? "Following releases"
                  : resolvedAction === "unfollow"
                    ? "Stopped following releases"
                    : resolvedAction === "unmute"
                      ? "Release notices unmuted"
                      : resolvedAction === "mute"
                        ? "Release notices muted"
                        : resolvedAction === "add-to-watchlist"
                          ? "Saved to watchlist"
                          : resolvedAction === "add-to-up-next"
                            ? "Added to Up Next"
                            : resolvedAction === "play-now"
                              ? "Starting playback"
                              : resolvedAction === "open-details"
                                ? "Opening details"
                                : resolvedAction === "update-app"
                                  ? "Opening release page in your browser"
                                  : "Action queued";
        setOverlayStatus(
          result.markReadError
            ? `${actionStatus}, but the notification remains unread`
            : actionStatus,
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

    if (overlay.type === "settings") {
      return;
    }

    const cancelActive = isOverlayCancelActive({
      overlay,
      pickerFilterQuery,
      historyPendingDelete,
    });

    if ((input === "c" && key.ctrl) || input === "\x03") {
      setOverlayClosePending(false);
    } else if (overlayClosePending) {
      setOverlayClosePending(false);
    }

    const overlayRoute = routeOverlayInput(input, key, {
      commandPaletteOpen: false,
      modalOpen: true,
      overlayOpen: true,
      textInputFocused: !cancelActive,
    });
    if (overlayRoute.command === "help" && input === "?" && !key.ctrl && !key.meta) {
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
        const backAction = resolveOverlayBackStack({
          nestedPaneActive: tracksNav.focusedPane === "options",
          pickerOverlay: true,
        });
        if (backAction === "exit-pane") {
          setTracksNav((nav) => tracksPanelNavReducer(nav, { type: "exit-section" }, navCtx));
        } else if (backAction === "cancel-picker") {
          container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
          container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
        }
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
      const backAction = resolveOverlayBackStack({
        cancelActive: shouldHandleOverlayEscape({
          overlay,
          pickerFilterQuery,
        }),
        filterQuery: isRootMediaPickerOverlay(overlay) ? (overlay.filterQuery ?? "") : filterQuery,
        confirmationActive:
          (overlay.type === "notifications" &&
            Boolean(notificationPlayConfirm || notificationActionDedupKey)) ||
          (overlay.type === "history" &&
            (historySourceChoiceTitleId !== null || historyPendingDelete !== null)),
        pickerOverlay: isRootMediaPickerOverlay(overlay),
        surfaceOwnsEscape: overlay.type === "library" || overlay.type === "downloads",
      });

      if (backAction === "clear-filter") {
        if (isRootMediaPickerOverlay(overlay) && overlay.id) {
          container.stateManager.dispatch({
            type: "UPDATE_PICKER_FILTER",
            id: overlay.id,
            filterQuery: "",
          });
        } else {
          setFilterQuery("");
          setSelectedIndex(0);
        }
        return;
      }

      if (backAction === "cancel-confirmation") {
        if (overlay.type === "history" && historySourceChoiceTitleId !== null) {
          setHistorySourceChoiceTitleId(null);
          setOverlayStatus(null);
        }
        if (overlay.type === "history" && historyPendingDelete !== null) {
          setHistoryPendingDelete(null);
          setOverlayStatus(null);
        }
        if (overlay.type === "notifications" && notificationPlayConfirm) {
          setNotificationPlayConfirm(null);
        }
        if (overlay.type === "notifications" && notificationActionDedupKey) {
          setNotificationActionDedupKey(null);
        }
        setSelectedIndex(0);
        return;
      }

      if (backAction === "cancel-picker" && isRootMediaPickerOverlay(overlay) && overlay.id) {
        container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
        return;
      }

      if (backAction === "defer-to-surface" || backAction === "no-op") {
        return;
      }

      cancelRootOverlay(overlay, container.stateManager);
      return;
    }
    if (overlay.type === "history") {
      if (
        handleHistoryOverlayInput(input, key, {
          container,
          historyView,
          historySelections,
          historyPickerContext,
          selectedIndex,
          sourceChoiceTitleId: historySourceChoiceTitleId,
          sourcePreference: continueSourcePreference,
          setSourceChoiceTitleId: setHistorySourceChoiceTitleId,
          setHistoryTypeFilter,
          setHistoryTab,
          setSelectedIndex,
          setOverlayStatus: (status) => setOverlayStatus(status),
          onRedraw,
          pendingDelete: historyPendingDelete,
          setPendingDelete: setHistoryPendingDelete,
          onHistoryMutated,
          onConfirmSelection: (selection, options) => {
            if (selection) {
              void import("@/services/continuation/continuation-diagnostics").then(
                ({ recordContinuationSourceResolution }) =>
                  recordContinuationSourceResolution(container, {
                    surface: "history",
                    selection,
                    preference: continueSourcePreference,
                    override: options?.sourceOverride,
                    resolved: selection.localJobId ? "local" : "stream",
                  }),
              );
            }
            resolveRootHistorySelection(selection);
            if (selection) {
              container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
            }
          },
        }) === "handled"
      ) {
        return;
      }
    }
    if (overlay.type === "queue") {
      // Handle queue management keys; let arrows / filtering fall through to the
      // generic choice handlers below (queue is in the optionCount switch).
      const queueRows = queueView.rows;
      const refresh = () => setQueueTick((tick) => tick + 1);
      const sel = queueRows.length === 0 ? -1 : Math.min(selectedIndex, queueRows.length - 1);
      const row = sel >= 0 ? queueRows[sel] : undefined;
      if (key.return && row) {
        const entry = container.queueService.getAll().find((candidate) => candidate.id === row.id);
        if (entry) {
          resolveRootQueueSelection({
            kind: "play",
            titleId: entry.titleId,
            title: entry.title,
            mediaKind: entry.mediaKind,
            season: entry.season,
            episode: entry.episode,
          });
          container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
        }
        return;
      }
      if (input === "J" && row) {
        if (container.queueService.moveDown(row.id))
          setSelectedIndex((c) => Math.min(c + 1, queueRows.length - 1));
        refresh();
        return;
      }
      if (input === "K" && row) {
        if (container.queueService.moveUp(row.id)) setSelectedIndex((c) => Math.max(c - 1, 0));
        refresh();
        return;
      }
      if (input === "g" && row) {
        container.queueService.moveToTop(row.id);
        refresh();
        return;
      }
      if (input === "G" && row) {
        container.queueService.moveToBottom(row.id);
        refresh();
        return;
      }
      if (input.toLowerCase() === "x" && row) {
        container.queueService.remove(row.id);
        setSelectedIndex((c) => Math.max(0, Math.min(c, queueRows.length - 2)));
        refresh();
        return;
      }
      if (input === "C") {
        container.queueService.clearPlayed();
        setSelectedIndex(0);
        refresh();
        return;
      }
      if (input === "c" && !key.ctrl) {
        container.queueService.clear();
        setSelectedIndex(0);
        refresh();
        return;
      }
      if (input.toLowerCase() === "r") {
        const sessions = container.queueService.listRecoverableSessions();
        // Sessions come back most-recent-first; naming the target in the status
        // line is what makes this restore explicit rather than a silent guess.
        const session = sessions[0];
        if (!session) {
          setOverlayStatus("No recoverable queue to restore");
          return;
        }
        const restored = restoreQueueSessionWithResume(
          buildQueueRestoreDeps(container),
          session.id,
        );
        setOverlayStatus(buildQueueRestoreStatus(restored, sessions.length));
        refresh();
        return;
      }
      // No early return — arrows + filtering fall through.
    }
    if (
      overlay.type === "notifications" &&
      !notificationActionDedupKey &&
      !notificationPlayConfirm
    ) {
      if (
        handleNotificationsOverlayInput(input, key, {
          container,
          state: notificationsState,
          view: notificationsView,
          setState: setNotificationsState,
          onRedraw,
          setOverlayStatus,
          setNotificationActionDedupKey,
          setFilterQuery,
          setSelectedIndex,
        }) === "handled"
      ) {
        return;
      }
    }
    if (key.return) {
      if (overlay.type === "provider_picker") {
        const picked = filteredProviderOptions[selectedIndex]?.value;
        if (picked) {
          void (async () => {
            await applyProviderPickerSelection({
              container,
              pickedProviderId: picked,
              reason: "provider-picker-switch",
            });
          })();
        }
        container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
        return;
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
          const actionId = getSelectedNotificationActionId(
            filteredNotificationActionOptions,
            selectedIndex,
          );
          if (!actionId) return;
          runNotificationAction(notificationActionDedupKey, actionId);
          setNotificationActionDedupKey(null);
          setFilterQuery("");
          setSelectedIndex(0);
        } else {
          runNotificationAction(notificationsView.selectedRow?.dedupKey ?? null);
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
    if (overlay.type === "diagnostics" && input === " ") {
      const targetSpanId = findDiagnosticsSpanIdNearScroll(lines, scrollIndex);
      if (!targetSpanId) return;
      const model = buildDiagnosticsSpanModel(
        buildDiagnosticsPanelInput(container, {
          expandedSpanIds: diagnosticsExpandedSpanIds,
        }).recentEvents,
      );
      const current = resolveDiagnosticsExpandedSpanIds(model, diagnosticsExpandedSpanIds);
      setDiagnosticsExpandedSpanIds(toggleDiagnosticsSpanExpanded(current, targetSpanId));
      return;
    }
    if (
      overlay.type === "diagnostics" &&
      (input === "e" || input === "E") &&
      !key.ctrl &&
      !key.meta
    ) {
      void (async () => {
        try {
          const { exportLocalSupportBundle, buildSupportBundleExportDiagnosticContext } =
            await import("@/app-shell/export-local-support-bundle");
          const written = await exportLocalSupportBundle(container);
          setOverlayStatus(`Support bundle written: ${written.path}`);
          container.diagnosticsService.record(
            buildUiDiagnosticEvent({
              operation: "export-diagnostics",
              status: "succeeded",
              severity: "healthy",
              recommendedAction: "none",
              message: `Diagnostics exported to ${written.fileName}`,
              context: buildSupportBundleExportDiagnosticContext(written.fileName),
            }),
          );
        } catch (error) {
          setOverlayStatus(
            `Support bundle export failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
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
            : overlay.type === "queue"
              ? queueView.rows.length
              : overlay.type === "history"
                ? historyView.flatRows.length
                : overlay.type === "notifications"
                  ? activeNotificationPickerOptions.length
                  : filteredGenericPickerOptions.length;
        if (optionCount > 0) {
          setSelectedIndex((current) =>
            key.upArrow ? (current - 1 + optionCount) % optionCount : (current + 1) % optionCount,
          );
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
      // Episode picker: `m` TOGGLES the highlighted episode watched/unwatched
      // (writes completed history via the shared action router — single source of
      // truth). Intercepted before the filter editor so it is an action, not a
      // typed filter character.
      if (
        overlay.type === "episode_picker" &&
        input.toLowerCase() === "m" &&
        !key.ctrl &&
        !key.meta
      ) {
        const pickerState = container.stateManager.getState();
        const pickerTitle = pickerState.currentTitle;
        const optionValue = filteredGenericPickerOptions[pickerSelectedIndex]?.value;
        if (pickerTitle && optionValue) {
          const [seasonRaw, episodeRaw] = optionValue.split(":");
          const season = Number(seasonRaw);
          const episode = Number(episodeRaw);
          if (Number.isFinite(season) && Number.isFinite(episode)) {
            const mediaKind = pickerState.mode === "anime" ? "anime" : pickerTitle.type;
            const progress = container.historyRepository.getProgress(
              { id: pickerTitle.id, kind: mediaKind, title: pickerTitle.name },
              { season, episode },
            );
            const alreadyWatched = progress ? isFinished(progress) : false;
            void createContainerMediaActionRouter(container).run({
              actionId: alreadyWatched ? "mark-unwatched" : "mark-watched",
              item: {
                titleId: pickerTitle.id,
                title: pickerTitle.name,
                mediaKind,
                season,
                episode,
              },
              source: "episode-picker",
            });
            setOverlayStatus(
              `Marked S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")} ${
                alreadyWatched ? "unwatched" : "watched"
              }`,
            );
          }
        }
        return;
      }
      // Episode picker: `s` jumps to the season picker without hunting for Esc.
      // Resolves the picker with a reserved value the opener maps to "switch
      // season"; interception happens before the filter editor so it acts as a
      // shortcut, not a typed filter character.
      if (
        overlay.type === "episode_picker" &&
        input.toLowerCase() === "s" &&
        !key.ctrl &&
        !key.meta &&
        overlay.id
      ) {
        container.stateManager.dispatch({
          type: "RESOLVE_PICKER",
          id: overlay.id,
          value: EPISODE_PICKER_SWITCH_SEASON,
        });
        return;
      }
      if (
        shouldHistoryOverlayAcceptFilterInput({
          overlayType: overlay.type,
          pendingDelete: historyPendingDelete,
          sourceChoiceTitleId: historySourceChoiceTitleId,
        }) &&
        filterEditor.handleInput(input, key)
      ) {
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
              options: activeNotificationPickerOptions,
              filterQuery: notificationPlayConfirm ? "" : filterQuery,
              selectedIndex: Math.min(
                selectedIndex,
                Math.max(activeNotificationPickerOptions.length - 1, 0),
              ),
              busy: false,
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
            : overlay.type === "help" || overlay.type === "about" || overlay.type === "diagnostics"
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
    return wrapOverlayLayout(
      overlayLayout,
      <Box flexDirection="column" flexGrow={1}>
        <DownloadManagerContent
          container={container}
          onClose={() => container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" })}
        />
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            cursor={commandCursor}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}
        <ShellFooter
          taskLabel="x cancel/remove · r retry · Esc closes"
          actions={footerActions}
          mode="detailed"
          commandMode={commandMode}
        />
      </Box>,
    );
  }

  if (overlay.type === "library") {
    return wrapOverlayLayout(
      overlayLayout,
      <Box flexDirection="column" flexGrow={1}>
        <LibraryShell
          container={container}
          onClose={() => container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" })}
          initialView={overlay.view ?? "library"}
        />
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            cursor={commandCursor}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}
      </Box>,
    );
  }

  if (overlay.type === "settings") {
    return wrapOverlayLayout(
      overlayLayout,
      <Box flexDirection="column" flexGrow={1}>
        <SettingsShell
          container={container}
          width={overlayLayout.contentColumns}
          maxRows={maxLines}
          commandMode={commandMode}
          initialSectionId={overlay.initialSectionId}
          onClose={() => container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" })}
          onStatus={setOverlayStatus}
          onRedraw={onRedraw}
          hideChromeTitle
        />
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            cursor={commandCursor}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}
      </Box>,
    );
  }

  if (overlay.type === "notifications" && !notificationActionDedupKey && !notificationPlayConfirm) {
    return wrapOverlayLayout(
      overlayLayout,
      <Box flexDirection="column" flexGrow={1}>
        <NotificationsShell
          view={notificationsView}
          columns={overlayLayout.contentColumns}
          selectedIndex={notificationsView.selectedIndex}
          unreadCount={notificationUnreadCount}
        />
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            cursor={commandCursor}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}
        <ShellFooter
          taskLabel="Notifications"
          actions={notificationsFooterActions({
            tab: notificationsState.tab,
            paginated: notificationsView.totalPages > 1,
          })}
          mode="detailed"
          commandMode={commandMode}
          terminalWidth={cols}
        />
      </Box>,
    );
  }

  if (overlay.type === "queue") {
    const {
      innerWidth,
      listWidth: pickerListWidth,
      rowWidth,
    } = getPickerLayout(overlayLayout.contentColumns, overlayLayout.contentRows);
    const listWidth = pickerListWidth ?? innerWidth;
    const qSelected =
      queueView.rows.length === 0 ? 0 : Math.min(selectedIndex, queueView.rows.length - 1);
    const qRow = queueView.rows[qSelected];
    const queueViewForRender = {
      ...queueView,
      selectedIndex: qSelected,
      rail: qRow
        ? {
            title: qRow.title,
            episodeLabel: qRow.episodeLabel,
            sourceLabel: qRow.sourceLabel,
            posterUrl: qRow.posterUrl,
          }
        : null,
    };

    return wrapOverlayLayout(
      overlayLayout,
      <Box flexDirection="column" flexGrow={1}>
        <ContextStrip
          items={[
            {
              label: `${queueView.counts.unplayed} up next · ${queueView.counts.total} total`,
              tone: "info",
            },
          ]}
        />
        <QueueShell
          view={queueViewForRender}
          columns={overlayLayout.contentColumns}
          listWidth={listWidth}
          rowWidth={rowWidth}
        />
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            cursor={commandCursor}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}
        <ShellFooter
          taskLabel="Up Next"
          actions={queueFooterActions()}
          mode="detailed"
          commandMode={commandMode}
          terminalWidth={cols}
        />
      </Box>,
    );
  }

  if (overlay.type === "history") {
    const {
      innerWidth,
      listWidth: pickerListWidth,
      rowWidth,
    } = getPickerLayout(overlayLayout.contentColumns, overlayLayout.contentRows);
    const listWidth = pickerListWidth ?? innerWidth;

    return wrapOverlayLayout(
      overlayLayout,
      <Box flexDirection="column" flexGrow={1}>
        <ContextStrip
          items={[
            {
              label: loadingAsyncLines
                ? "loading history"
                : `${historyView.flatRows.length} titles · ${historyView.tabLabels[historyView.tabIndex] ?? "All"}`,
              tone: "info",
            },
          ]}
        />
        <HistoryShell
          view={historyView}
          columns={overlayLayout.contentColumns}
          listWidth={listWidth}
          rowWidth={rowWidth}
          pendingDelete={historyPendingDelete}
        />
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
            historyPendingDelete
              ? historyPendingDelete.kind === "episode"
                ? `Delete episode progress for ${historyPendingDelete.label}? y confirm · Esc cancel`
                : `Delete all history for ${historyPendingDelete.label}? y confirm · Esc cancel`
              : historySourceChoiceTitleId
                ? "History · l local, s stream, Esc cancel"
                : "History"
          }
          actions={historyFooterActions()}
          mode="detailed"
          commandMode={commandMode}
          terminalWidth={cols}
        />
      </Box>,
    );
  }

  if (overlay.type === "help") {
    const helpScope = resolveHelpScope(state);
    const scopeSections = helpSectionsForScope(helpScope);
    // Merge the slash commands that are actually live on this surface so the
    // overlay documents both chords and `/commands` in one reference.
    const commandItems = commands
      .filter((command) => command.enabled)
      .map((command) => ({
        keys: `/${command.aliases[0] ?? command.label.toLowerCase()}`,
        label: command.description || command.label,
      }));
    const helpScopeSections =
      commandItems.length > 0
        ? [...scopeSections, { group: "Commands", items: commandItems }]
        : scopeSections;
    return wrapOverlayLayout(
      overlayLayout,
      <HelpShell
        sections={helpScopeSections}
        scopeLabel={HELP_SCOPE_LABELS[helpScope]}
        commandMode={commandMode}
        commandInput={commandInput}
        commandCursor={commandCursor}
        commands={commands}
        highlightedIndex={highlightedIndex}
        footerActions={footerActions}
        onClose={() => container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" })}
      />,
    );
  }

  if (overlay.type === "tracks_panel") {
    const tracksHasSwitchable = trackGroups.some((group) => group.rows.some((row) => row.enabled));
    return wrapOverlayLayout(
      overlayLayout,
      <Box flexDirection="column" flexGrow={1}>
        {effectiveSubtitle.trim() ? (
          <ContextStrip items={[{ label: effectiveSubtitle, tone: "neutral" }]} />
        ) : null}
        <TracksPanelShell
          groups={trackGroups}
          nav={tracksNav}
          favorites={tracksFavorites}
          providerLabel={overlay.type === "tracks_panel" ? overlay.providerLabel : undefined}
          width={overlayLayout.contentColumns}
          height={overlayLayout.contentRows}
        />
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
      </Box>,
    );
  }

  return wrapOverlayLayout(
    overlayLayout,
    <Box flexDirection="column" flexGrow={1}>
      <ContextStrip
        items={
          // Header pill already owns the overlay name (Settings/Diagnostics/…).
          // Strip only the secondary progress / count so we don't re-title.
          overlay.type === "diagnostics"
            ? [
                {
                  label: `${Math.min(scrollIndex + maxLines, lines.length)}/${lines.length} lines`,
                  tone: "info" as const,
                },
              ]
            : [
                {
                  label:
                    overlay.type === "provider_picker"
                      ? `${filteredProviderOptions.length} options`
                      : overlay.type === "notifications"
                        ? notificationActionDedupKey
                          ? `${filteredNotificationActionOptions.length} actions`
                          : `${filteredNotificationOptions.length} options`
                        : isRootMediaPickerOverlay(overlay)
                          ? `${filteredGenericPickerOptions.length} options`
                          : `${Math.min(scrollIndex + maxLines, lines.length)}/${lines.length} lines`,
                  tone: "info" as const,
                },
              ]
        }
      />
      <OverlayPanel
        overlay={overlayPanel}
        width={overlayLayout.contentColumns}
        maxLinesOverride={maxLines}
      />

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
            ? "Type to filter · Enter switch · Esc closes"
            : overlay.type === "diagnostics"
              ? "↑/↓ scroll · Space toggle span · e export · Esc closes"
              : overlay.type === "notifications"
                ? notificationActionDedupKey
                  ? "Enter runs · Esc returns"
                  : "Enter acts · a actions · x dismisses"
                : isRootMediaPickerOverlay(overlay)
                  ? title
                  : "Esc closes"
        }
        actions={footerActions}
        mode="detailed"
        commandMode={commandMode}
      />
    </Box>,
  );
}
