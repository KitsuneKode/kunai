import { browseOptionFromMediaItem } from "@/app-shell/browse-option-from-media-item";
import { useLineEditor } from "@/app-shell/line-editor";
import { addSearchQuery, getSearchHistory } from "@/app-shell/search-history";
import type { SearchResult } from "@/domain/types";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { Box, Text, useInput } from "ink";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  applyBrowseResultFilters,
  describeBrowseResultFilters,
  hasBrowseResultFilters,
  parseBrowseFilterQuery,
} from "./browse-filters";
import {
  browseFocusZoneReducer,
  createInitialBrowseFocusZone,
  isBrowseFilterFocused,
  isBrowseIdleFocused,
  isBrowseListFocused,
  type BrowseFocusZone,
  type BrowseFocusZoneContext,
  type BrowseFocusZoneEvent,
} from "./browse-focus-zone";
import { buildBrowseIdleReturnLoopModel, resolveIdleRowAction } from "./browse-idle-actions";
import {
  browseResultStatusLine,
  buildPreviewRailModelFromBrowseOption,
  filterBrowseOptionsByResultFilter,
  mapPosterPreviewState,
} from "./browse-preview-rail";
import {
  isQueryDirty,
  normalizeBrowseCommandInput,
  resolveDetailsOverlaySubmitValue,
} from "./browse-search-state";
import {
  CalendarDayStrip,
  CalendarScheduleRow,
  CalendarScheduleStatus,
  CalendarTypeTabs,
} from "./calendar-ui";
import {
  buildCalendarEmptyState,
  buildCalendarErrorState,
  buildCalendarLoadingState,
  buildCalendarPreviewRailModel,
  buildCalendarRenderRows,
  filterCalendarOptionsByDay,
  filterCalendarOptionsByType,
  windowCalendarRowsByLines,
  type CalendarTypeTab,
} from "./calendar-ui.model";
import { sortCalendarOptions } from "./calendar-view";
import type { ResolvedAppCommand } from "./commands";
import { DetailsSheetUI } from "./details-pane-ui";
import {
  buildBrowseDetailsPanel,
  buildDetailsPanelDataFromBrowseOption,
  buildDetailsSheetLines,
  resolveBrowseDetailsSecondary,
  type DetailsPanelData,
} from "./details-panel";
import { InlineDotMatrixLoader } from "./dot-matrix-loader";
import { requestHardExit } from "./graceful-exit";
import { useCalendarState } from "./hooks/use-calendar-state";
import { deleteAllKittyImages } from "./image-pane";
import {
  getBrowseChromeRows,
  getBrowseCommandPaletteMaxVisible,
  getBrowseListMaxVisible,
} from "./layout-policy";
import type { BrowseOverlay } from "./overlay-panel";
import { OverlayPanel } from "./overlay-panel";
import { PreviewRail } from "./primitives/PreviewRail";
import { shouldRenderPreviewRail } from "./primitives/PreviewRail.model";
import { mountRootContent } from "./root-content-state";
import {
  getNotificationDetailsPending,
  subscribeNotificationDetails,
  takeNotificationDetailsItem,
} from "./root-overlay-bridge";
import {
  getCommandAutocompleteTarget,
  getCommandMatches,
  getHighlightedCommand,
} from "./shell-command-model";
import { CommandPalette } from "./shell-command-ui";
import { getCommandLabel, InputField } from "./shell-frame";
import { ContextStrip, ResizeBlocker, ShellFooter, selectFooterActions } from "./shell-primitives";
import {
  getWindowStart,
  measureColumns,
  padColumnsEnd,
  padColumnsStart,
  truncateLine,
} from "./shell-text";
import { contentTintColor, palette } from "./shell-theme";
import { SkeletonRows } from "./skeleton";
import {
  toShellAction,
  type FooterAction,
  type BrowseShellOption,
  type BrowseShellResult,
  type BrowseShellSearchResponse,
  type ShellPanelLine,
  type ShellPickerOption,
  type ShellAction,
  type ShellFooterMode,
} from "./types";
import { usePosterPreview } from "./use-poster-preview";
import { useDebouncedViewportPolicy } from "./use-viewport-policy";

/** Minimum loaded results before local narrow mode is worth its space. */
const MIN_RESULTS_FOR_LOCAL_FILTER = 12;

function clearShellScreen() {
  if (process.stdout.isTTY) {
    deleteAllKittyImages();
  }
}

/**
 * Render an unknown error in a user-visible string. An `Error` with a message
 * gets its message; everything else gets `String(error)` so we never show
 * `[object Object]` to the user (the old `String(error)` call did that when
 * the caught value was a plain object).
 */
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

export function BrowseShell<T>({
  provider,
  initialQuery,
  initialResults,
  initialResultSubtitle,
  initialSelectedIndex,
  initialCalendarTypeTab,
  placeholder,
  commands,
  providerOptions: _providerOptions,
  loadHistoryPanel: _loadHistoryPanel,
  loadDiagnosticsPanel: _loadDiagnosticsPanel,
  loadHelpPanel: _loadHelpPanel,
  loadAboutPanel: _loadAboutPanel,
  onChangeProvider: _onChangeProvider,
  onSearch,
  onLoadDiscovery,
  onLoadRecommendations,
  footerMode: _footerMode = "detailed",
  settings: _settings,
  settingsSeriesProviderOptions: _settingsSeriesProviderOptions,
  settingsAnimeProviderOptions: _settingsAnimeProviderOptions,
  onSaveSettings: _onSaveSettings,
  onQueueSelected,
  onFollowSelected,
  onResolve,
  onSubmit,
  onCancel,
  idleContext,
}: {
  mode: "series" | "anime";
  provider: string;
  initialQuery?: string;
  initialResults?: readonly BrowseShellOption<T>[];
  initialResultSubtitle?: string;
  initialSelectedIndex?: number;
  initialCalendarTypeTab?: CalendarTypeTab;
  placeholder: string;
  commands: readonly ResolvedAppCommand[];
  providerOptions?: readonly ShellPickerOption<string>[];
  loadHistoryPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadDiagnosticsPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadHelpPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadAboutPanel?: () => Promise<readonly ShellPanelLine[]>;
  onChangeProvider?: (providerId: string) => Promise<void>;
  onSearch: (query: string) => Promise<BrowseShellSearchResponse<T>>;
  onLoadDiscovery?: () => Promise<BrowseShellSearchResponse<T>>;
  onLoadRecommendations?: () => Promise<BrowseShellSearchResponse<T>>;
  footerMode?: ShellFooterMode;
  settings?: KitsuneConfig;
  settingsSeriesProviderOptions?: readonly ShellPickerOption<string>[];
  settingsAnimeProviderOptions?: readonly ShellPickerOption<string>[];
  onSaveSettings?: (next: KitsuneConfig) => Promise<void>;
  onQueueSelected?: (value: T) => Promise<void> | void;
  onFollowSelected?: (value: T) => Promise<void> | void;
  onResolve: (action: ShellAction) => void;
  onSubmit: (value: T) => void;
  onCancel: () => void;
  idleContext?: import("./types").BrowseIdleContext;
}) {
  const viewport = useDebouncedViewportPolicy("browse", {
    zen: _settings?.zenMode,
  });
  const [query, setQuery] = useState(initialQuery ?? "");
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [highlightedCommandIndex, setHighlightedCommandIndex] = useState(0);
  const commandEditor = useLineEditor({
    value: commandInput,
    onChange: (nextValue) => {
      setCommandInput(nextValue);
      setHighlightedCommandIndex(0);
    },
    onRedraw: clearShellScreen,
  });
  const [activeOverlay, setActiveOverlay] = useState<BrowseOverlay | null>(null);
  const [options, setOptions] = useState<readonly BrowseShellOption<T>[]>(initialResults ?? []);
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex ?? 0);
  const [resultSubtitle, setResultSubtitle] = useState(initialResultSubtitle ?? "");
  const [calendarNow, setCalendarNow] = useState(() => Date.now());
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">(
    initialResults && initialResults.length > 0 ? "ready" : "idle",
  );
  const [lastSearchedQuery, setLastSearchedQuery] = useState(
    initialResults && initialResults.length > 0 ? (initialQuery ?? "") : "",
  );
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftQuery, setDraftQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState(
    "Search for a title — or try /trending to see what's popular",
  );
  const [activeFilterBadges, setActiveFilterBadges] = useState<readonly string[]>([]);
  const [resultFilter, setResultFilter] = useState("");
  const [filterModeOpen, setFilterModeOpen] = useState(false);
  // Focus zones: query (text) → list (bare hotkeys) → filter (local narrow) → idle.
  // See browse-focus-zone.ts and .docs/ux-architecture.md.
  const [focusZone, setFocusZone] = useState<BrowseFocusZone>(() =>
    createInitialBrowseFocusZone({
      startIdle: !!(
        _settings?.minimalMode &&
        idleContext?.continueWatching?.titleId &&
        (!initialResults || initialResults.length === 0)
      ),
    }),
  );
  const [idleSelectedIndex, setIdleSelectedIndex] = useState(0);
  const focusZoneContextRef = useRef<BrowseFocusZoneContext>({
    hasResults: false,
    hasFilterBar: false,
    canFocusIdle: false,
    selectedIndex: 0,
  });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setCalendarNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [companionDetails, setCompanionDetails] = useState<DetailsPanelData>(() =>
    buildDetailsPanelDataFromBrowseOption(initialResults?.[initialSelectedIndex ?? 0]),
  );

  // Calendar view detection and day-strip derived state.
  // A structured `calendar` item is only attached by the calendar surface, so it is
  // the authoritative signal. previewGroup/subtitle remain as legacy fallbacks.
  const isCalendarView =
    options.some((opt) => opt.calendar !== undefined || opt.previewGroup !== undefined) ||
    resultSubtitle.includes("schedule") ||
    resultSubtitle.includes("airing today");

  // Calendar UI state (type tab + day filter + derived day strip) lives in one hook.
  // Reads are aliased below so the rest of the component is unchanged; writes go
  // through the hook's actions (calendar.reset / cycleType / stepDay / toggleAllDays).
  const calendar = useCalendarState({
    isCalendarView,
    options: options as readonly BrowseShellOption<import("@/domain/types").SearchResult>[],
    initialTypeTab: initialCalendarTypeTab,
  });
  const calendarTypeTab = calendar.typeTab;
  const calendarDayFilter = calendar.dayFilter;
  const calendarDays = calendar.days;
  // Stable action refs (each is useCallback-memoized in the hook) so consuming
  // callbacks/effects can depend on them without re-creating every render.
  const {
    reset: resetCalendar,
    cycleType: cycleCalendarType,
    stepDay: stepCalendarDay,
    toggleAllDays: toggleCalendarAllDays,
    setDayFilter: setCalendarDay,
  } = calendar;

  const displayOptions = useMemo(() => {
    const narrowed = filterBrowseOptionsByResultFilter(options, resultFilter);
    if (!isCalendarView) return narrowed;
    const scheduleOptions = narrowed as readonly BrowseShellOption<
      import("@/domain/types").SearchResult
    >[];
    const typed = filterCalendarOptionsByType(scheduleOptions, calendarTypeTab);
    const byDay = filterCalendarOptionsByDay(typed, calendarDayFilter);
    return sortCalendarOptions(byDay) as typeof options;
  }, [calendarDayFilter, calendarTypeTab, isCalendarView, options, resultFilter]);

  const clearResults = useCallback(() => {
    setOptions([]);
    setSelectedIndex(0);
    setSearchState("idle");
    setLastSearchedQuery("");
    setErrorMessage(null);
    setEmptyMessage("Search for a title — or try /trending to see what's popular");
    setResultSubtitle("");
    setActiveFilterBadges([]);
    setResultFilter("");
    setFilterModeOpen(false);
    setFocusZone("query");
    resetCalendar();
  }, [resetCalendar]);

  const updateQuery = useCallback(
    (nextValue: string) => {
      const normalized = normalizeBrowseCommandInput(nextValue);
      setQuery(normalized.value);
      setHistoryIndex(-1);
      if (normalized.openCommandPalette) {
        setCommandMode(true);
        setCommandInput("");
        setHighlightedCommandIndex(0);
      }
      if (normalized.value.trim().length === 0) {
        clearResults();
      }
    },
    [clearResults],
  );

  const runSearch = useCallback(async () => {
    const parsedQuery = parseBrowseFilterQuery(query);
    const trimmed = parsedQuery.searchQuery.trim();
    const rawQuery = query.trim();
    const hasFilters = hasBrowseResultFilters(parsedQuery.filters);
    if (rawQuery.length === 0 || (trimmed.length === 0 && !hasFilters) || searchState === "loading")
      return;
    const filterBadges = describeBrowseResultFilters(parsedQuery.filters);

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSearchState("loading");
    setFocusZone("query");
    setErrorMessage(null);
    setEmptyMessage("Searching…");
    resetCalendar();

    try {
      const response = await onSearch(rawQuery);
      if (requestIdRef.current !== requestId) return;
      const needsLocalFilters =
        response.localFilterBadges === undefined && response.upstreamFilterBadges === undefined;
      const filteredOptions = needsLocalFilters
        ? applyBrowseResultFilters(response.options, parsedQuery.filters)
        : response.options;
      const activeBadges = [
        ...(response.upstreamFilterBadges ?? filterBadges).map((badge) => `upstream ${badge}`),
        ...(response.localFilterBadges ?? []).map((badge) => `local ${badge}`),
        ...(response.unsupportedFilterBadges ?? []).map((badge) => `unsupported ${badge}`),
      ];
      const filterSuffix = activeBadges.length > 0 ? `  ·  ${activeBadges.join(", ")}` : "";

      setLastSearchedQuery(rawQuery);
      setResultFilter("");
      setFilterModeOpen(false);
      setFocusZone("query");
      addSearchQuery(rawQuery);
      setOptions(filteredOptions);
      setSelectedIndex(0);
      setResultSubtitle(`${response.subtitle}${filterSuffix}`);
      setEmptyMessage(
        activeBadges.length > 0
          ? "No results matched those filters."
          : (response.emptyMessage ?? "No results found."),
      );
      setActiveFilterBadges(activeBadges);
      setSearchState("ready");
    } catch (error) {
      if (requestIdRef.current !== requestId) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(formatError(error));
      setEmptyMessage("Search failed.");
    }
  }, [query, searchState, onSearch, resetCalendar]);

  const handleQuerySubmit = useCallback(() => {
    const isDirty = query.trim() !== lastSearchedQuery;
    const selected = displayOptions[selectedIndex];
    if (!isDirty && selected && displayOptions.length > 0 && searchState === "ready") {
      onSubmit(selected.value);
      return;
    }
    void runSearch();
  }, [query, lastSearchedQuery, displayOptions, selectedIndex, searchState, onSubmit, runSearch]);

  const loadDiscovery = async () => {
    if (!onLoadDiscovery || searchState === "loading") return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setQuery("");
    setSearchState("loading");
    setErrorMessage(null);
    setEmptyMessage("Loading trending…");
    resetCalendar();

    try {
      const response = await onLoadDiscovery();
      if (requestIdRef.current !== requestId) return;

      setLastSearchedQuery("");
      setOptions(response.options);
      setSelectedIndex(0);
      setResultSubtitle(response.subtitle);
      setEmptyMessage(response.emptyMessage ?? "Trending is unavailable right now.");
      setActiveFilterBadges([]);
      setSearchState("ready");
    } catch (error) {
      if (requestIdRef.current !== requestId) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(formatError(error));
      setEmptyMessage("Trending failed.");
    }
  };

  const loadRecommendations = async () => {
    if (!onLoadRecommendations || searchState === "loading") return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setQuery("");
    setSearchState("loading");
    setErrorMessage(null);
    setEmptyMessage("Loading recommendations…");
    resetCalendar();

    try {
      const response = await onLoadRecommendations();
      if (requestIdRef.current !== requestId) return;

      setLastSearchedQuery("");
      setOptions(response.options);
      setSelectedIndex(0);
      setResultSubtitle(response.subtitle);
      setEmptyMessage(response.emptyMessage ?? "Recommendations are unavailable right now.");
      setActiveFilterBadges([]);
      setSearchState("ready");

      if (response.revalidate) {
        void response.revalidate
          .then((nextResponse) => {
            if (requestIdRef.current !== requestId) return undefined;
            setOptions(nextResponse.options);
            setSelectedIndex(0);
            setResultSubtitle(nextResponse.subtitle);
            setEmptyMessage(
              nextResponse.emptyMessage ?? "Recommendations are unavailable right now.",
            );
            return undefined;
          })
          .catch(() => {
            // keep current recommendation results; background revalidation is best-effort
            return undefined;
          });
      }
    } catch (error) {
      if (requestIdRef.current !== requestId) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(formatError(error));
      setEmptyMessage("Recommendations failed.");
    }
  };

  const closeOverlay = () => {
    setActiveOverlay(null);
  };

  useEffect(() => {
    if (displayOptions.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, displayOptions.length - 1));
  }, [displayOptions.length]);

  const boundedSelectedIndex =
    displayOptions.length === 0 ? 0 : Math.min(selectedIndex, displayOptions.length - 1);
  const selectedOption = displayOptions[boundedSelectedIndex];

  const openDetailsOverlay = useCallback(
    (option?: BrowseShellOption<T>) => {
      const resolved = option ?? selectedOption;
      if (!resolved) return;
      const panel = buildBrowseDetailsPanel(resolved);
      const sheetLines = buildDetailsSheetLines(resolved, companionDetails.secondary);
      setCommandMode(false);
      setFocusZone("query");
      setActiveOverlay({
        type: "details",
        title: panel.title,
        subtitle: panel.subtitle,
        lines: sheetLines.length > 0 ? sheetLines : panel.lines,
        detailData: buildDetailsPanelDataFromBrowseOption(resolved),
        imageUrl: panel.imageUrl,
        loading: false,
        scrollIndex: 0,
      });
    },
    [companionDetails.secondary, selectedOption],
  );

  const notificationDetailsPending = useSyncExternalStore(
    subscribeNotificationDetails,
    getNotificationDetailsPending,
    () => false,
  );
  useEffect(() => {
    if (!notificationDetailsPending) return;
    const item = takeNotificationDetailsItem();
    if (!item) return;
    openDetailsOverlay(browseOptionFromMediaItem(item) as BrowseShellOption<T>);
  }, [notificationDetailsPending, openDetailsOverlay]);

  const handleLocalAction = (action: ShellAction): boolean => {
    if (action === "details") {
      openDetailsOverlay();
      return true;
    }
    if (action === "filters") {
      if (searchState === "ready" && options.length > 0 && !isCalendarView) {
        setFilterModeOpen(true);
        setCommandMode(false);
        setCommandInput("");
        setHighlightedCommandIndex(0);
        setFocusZone("filter");
      }
      return true;
    }
    if (action === "trending") {
      setCommandMode(false);
      setCommandInput("");
      setHighlightedCommandIndex(0);
      void loadDiscovery();
      return true;
    }
    if (action === "recommendation") {
      setCommandMode(false);
      setCommandInput("");
      setHighlightedCommandIndex(0);
      void loadRecommendations();
      return true;
    }
    return false;
  };

  const listFocused = isBrowseListFocused(focusZone);
  const resultFilterFocused = isBrowseFilterFocused(focusZone);
  const idleFocused = isBrowseIdleFocused(focusZone);

  const queryDirty = isQueryDirty({
    queryDraft: query,
    submittedQuery: lastSearchedQuery,
    resultFilter,
    focusedRegion: resultFilterFocused ? "result-filter" : "query",
    selectedIndex: boundedSelectedIndex,
    detailsOpen: activeOverlay?.type === "details",
    detailsScroll:
      activeOverlay && "scrollIndex" in activeOverlay ? (activeOverlay.scrollIndex ?? 0) : 0,
  });

  const dispatchFocusZone = useCallback((event: BrowseFocusZoneEvent) => {
    setFocusZone((current) => browseFocusZoneReducer(current, event, focusZoneContextRef.current));
  }, []);

  useEffect(() => {
    setIdleSelectedIndex(0);
  }, [idleContext]);

  const idleReturnLoopModel = buildBrowseIdleReturnLoopModel(idleContext, {
    idleFocused,
    selectedIndex: idleSelectedIndex,
  });
  const canFocusIdleRows =
    options.length === 0 &&
    searchState === "idle" &&
    Boolean(idleReturnLoopModel?.hasSelectableRows);

  // Local narrow mode only earns space on long result sets. It is explicit
  // (/filters or Ctrl+F) so normal title search stays calm and single-purpose.
  const showResultFilterBar =
    searchState === "ready" &&
    options.length >= MIN_RESULTS_FOR_LOCAL_FILTER &&
    !isCalendarView &&
    !viewport.ultraCompact &&
    (filterModeOpen || resultFilter.length > 0);

  focusZoneContextRef.current = {
    hasResults: displayOptions.length > 0,
    hasFilterBar: showResultFilterBar,
    canFocusIdle: canFocusIdleRows,
    selectedIndex: boundedSelectedIndex,
  };

  // Never strand focus on a list that has emptied — hand focus back to query.
  useEffect(() => {
    if (displayOptions.length === 0 && isBrowseListFocused(focusZone)) {
      setFocusZone((current) =>
        browseFocusZoneReducer(
          current,
          { type: "results-became-empty" },
          focusZoneContextRef.current,
        ),
      );
    }
  }, [displayOptions.length, focusZone]);

  useEffect(() => {
    const primaryData = buildDetailsPanelDataFromBrowseOption(selectedOption);
    setCompanionDetails(primaryData);
    let cancelled = false;
    void (async () => {
      await Bun.sleep(32);
      if (cancelled) return;
      const secondary = resolveBrowseDetailsSecondary(selectedOption, { providerName: provider });
      setCompanionDetails((current) => ({
        ...current,
        primary: primaryData.primary,
        secondary,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, selectedOption]);

  const { compact, ultraCompact, minColumns, minRows } = viewport;
  // Short terminals: collapse schedule chrome margins so the list keeps its rows.
  const denseChrome = viewport.rows < 28;
  const browseBreakpoint = viewport.breakpoint;
  const showCompanionLayout = browseBreakpoint === "wide" || browseBreakpoint === "medium";
  const effectiveFooterMode = "minimal";
  const innerWidth = Math.max(24, viewport.columns - 8);
  // Tiered companion widths: wide gets 30%, medium gets 28%, compact gets full width below list
  const previewWidth =
    browseBreakpoint === "wide"
      ? Math.max(28, Math.floor(innerWidth * 0.3))
      : browseBreakpoint === "medium"
        ? Math.max(26, Math.floor(innerWidth * 0.28))
        : innerWidth;
  const listWidth = showCompanionLayout ? Math.max(48, innerWidth - previewWidth - 4) : innerWidth;
  const rowWidth = Math.max(20, listWidth - 4);
  // The "Series"/"Movie" type is a quiet column only when the result set is
  // actually mixed; an all-series list never repeats "Series" on every row.
  const resultsAreMixed =
    !isCalendarView &&
    displayOptions.some((option) => option.previewMeta?.[0] === "Series") &&
    displayOptions.some((option) => option.previewMeta?.[0] === "Movie");
  // While the command palette is open, focus belongs to the palette — keep the
  // companion preview hidden so its (taller) content can't overlap the palette
  // rows or get clipped against the bottom of the viewport.
  const showCompanion = showCompanionLayout && !compact && !commandMode && Boolean(selectedOption);
  const { poster, posterState: posterPreviewState } = usePosterPreview(
    selectedOption?.previewImageUrl ?? undefined,
    {
      rows: 9,
      cols: Math.max(14, Math.min(20, previewWidth - 6)),
      enabled: Boolean(selectedOption?.previewImageUrl),
      debounceMs: 90,
      variant: "detail",
    },
  );
  const mappedPosterState = mapPosterPreviewState({
    hasPosterPath: Boolean(selectedOption?.previewImageUrl),
    poster,
    posterState: posterPreviewState,
  });
  const previewRailModel = isCalendarView
    ? buildCalendarPreviewRailModel(
        selectedOption as BrowseShellOption<SearchResult> | undefined,
        mappedPosterState,
      )
    : buildPreviewRailModelFromBrowseOption(selectedOption, mappedPosterState);
  const showPreviewRail =
    showCompanion &&
    viewport.previewRail &&
    shouldRenderPreviewRail({ columns: viewport.columns, hasModel: previewRailModel !== null });
  const resultStatus = browseResultStatusLine({
    resultSubtitle,
    resultFilter,
    displayCount: displayOptions.length,
    totalCount: options.length,
  });
  const calendarSurfaceActive =
    isCalendarView ||
    resultSubtitle.toLowerCase().includes("schedule") ||
    emptyMessage.toLowerCase().includes("schedule");
  const calendarEmptyModeLabel =
    calendarTypeTab === "All" ? "calendar" : calendarTypeTab.toLowerCase();
  const browseChromeRows = getBrowseChromeRows({
    hasResultSubtitle: !ultraCompact && Boolean(resultStatus.primary || resultStatus.secondary),
    hasFilterBar: showResultFilterBar,
    hasFilterBadges: activeFilterBadges.length > 0 && !ultraCompact,
    hasCalendarChrome: isCalendarView && calendarDays.length > 0 && !ultraCompact,
    hasContextStrip: Boolean(activeOverlay || (queryDirty && displayOptions.length > 0)),
    hasQueryDirtyHint:
      queryDirty && displayOptions.length > 0 && !ultraCompact && !commandMode && !isCalendarView,
    commandMode,
  });
  const maxVisible = getBrowseListMaxVisible(viewport.rows, browseChromeRows);
  const windowStart = getWindowStart(boundedSelectedIndex, displayOptions.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, displayOptions.length);
  const visibleOptions = displayOptions.slice(windowStart, windowEnd);

  // Calendar rows inject section headers (For You / day bands) that cost extra
  // rendered lines, so the schedule windows by rendered LINES, not option count —
  // otherwise headers push rows past the viewport and into the footer.
  const calendarRenderRows = isCalendarView
    ? buildCalendarRenderRows(
        displayOptions as readonly BrowseShellOption<import("@/domain/types").SearchResult>[],
        0,
        displayOptions.length,
        calendarNow,
        calendarDayFilter,
        false,
        _settings?.lastCalendarVisitAt ?? 0,
      )
    : [];
  const calendarWindow = windowCalendarRowsByLines(
    calendarRenderRows,
    boundedSelectedIndex,
    maxVisible,
  );
  const visibleCalendarRows = calendarRenderRows.slice(calendarWindow.start, calendarWindow.end);

  useInput((input, key) => {
    if ((input === "c" && key.ctrl) || input === "\x03") {
      requestHardExit(0);
    }

    if (activeOverlay) {
      if (input === "/") {
        return;
      }

      if (key.escape) {
        closeOverlay();
        return;
      }

      if (key.return && activeOverlay.type === "details") {
        const value = resolveDetailsOverlaySubmitValue({
          detailsOpen: true,
          searchReady: searchState === "ready",
          selectedOption,
        });
        if (value !== null) {
          onSubmit(value);
        }
        return;
      }

      if (activeOverlay.type === "episode-picker") {
        return;
      }

      if ("lines" in activeOverlay && (key.upArrow || key.downArrow) && !activeOverlay.loading) {
        if (activeOverlay.lines.length === 0) {
          return;
        }
        const maxScroll = Math.max(0, activeOverlay.lines.length - 1);
        const nextScroll = key.upArrow
          ? Math.max(0, (activeOverlay.scrollIndex ?? 0) - 1)
          : Math.min(maxScroll, (activeOverlay.scrollIndex ?? 0) + 1);
        setActiveOverlay({ ...activeOverlay, scrollIndex: nextScroll });
      }
      return;
    }

    if (commandMode) {
      const matches = getCommandMatches(commandInput, commands);

      if (key.escape) {
        setCommandMode(false);
        setCommandInput("");
        setHighlightedCommandIndex(0);
        return;
      }
      if (key.return) {
        const resolved = getHighlightedCommand(commandInput, commands, highlightedCommandIndex);
        if (resolved?.enabled) {
          const action = toShellAction(resolved.id);
          if (!handleLocalAction(action)) {
            onResolve(action);
          }
        }
        return;
      }
      if (key.tab) {
        const target = getCommandAutocompleteTarget(
          commandInput,
          commands,
          highlightedCommandIndex,
        );
        if (target) {
          commandEditor.setValue(target.aliases[0] ?? target.id);
          const nextIndex = matches.findIndex((candidate) => candidate.id === target.id);
          setHighlightedCommandIndex(nextIndex >= 0 ? nextIndex : 0);
        }
        return;
      }
      if (key.upArrow) {
        if (matches.length > 0) {
          setHighlightedCommandIndex((current) => (current - 1 + matches.length) % matches.length);
        }
        return;
      }
      if (key.downArrow) {
        if (matches.length > 0) {
          setHighlightedCommandIndex((current) => (current + 1) % matches.length);
        }
        return;
      }
      if (commandEditor.handleInput(input, key)) {
        return;
      }
      return;
    }

    if (input === "/") {
      setCommandMode(true);
      setCommandInput("");
      setHighlightedCommandIndex(0);
      return;
    }

    if ((input === "f" && key.ctrl) || input === "\x06") {
      if (searchState === "ready" && options.length > 0 && !isCalendarView) {
        setFilterModeOpen(true);
        setFocusZone("filter");
        setCommandMode(false);
      }
      return;
    }

    // ── Results-zone bindings (list focused = non-text state) ──
    // Plain Enter plays the highlighted row; these never fire while the query
    // field is focused, so typing in search is never hijacked.
    if (listFocused && key.return && !key.shift && selectedOption && searchState === "ready") {
      onSubmit(selectedOption.value);
      return;
    }

    // Details: Ctrl+O is the terminal-portable trigger that works in BOTH the
    // query and results zones. Shift+Enter is unreliable (most terminals never
    // deliver it), and bare `i` would type into the query box — so `i` only fires
    // once the results list owns focus. All three open the same overlay.
    if ((input === "o" && key.ctrl) || input === "\x0f") {
      if (selectedOption && searchState === "ready") openDetailsOverlay();
      return;
    }
    if (key.return && key.shift && selectedOption && searchState === "ready") {
      openDetailsOverlay();
      return;
    }
    if (listFocused && input.toLowerCase() === "i" && selectedOption && searchState === "ready") {
      openDetailsOverlay();
      return;
    }

    if ((input === "t" && key.ctrl) || input === "\x14") {
      void loadDiscovery();
      return;
    }

    // Open the Up Next queue (results zone; from the query field use /queue).
    if (listFocused && input === "Q") {
      onResolve("playlist");
      return;
    }

    // Download: Ctrl+D anywhere, or bare `d` in the results zone.
    if (
      (input === "d" && key.ctrl) ||
      input === "\x04" ||
      (listFocused && input.toLowerCase() === "d")
    ) {
      if (selectedOption && displayOptions.length > 0 && !queryDirty && searchState === "ready") {
        onResolve("download");
      }
      return;
    }

    // Queue: bare `q` only in the results zone (it would otherwise type into the
    // search box — the latent double-fire this focus model removes).
    if (listFocused && input.toLowerCase() === "q") {
      if (
        selectedOption &&
        onQueueSelected &&
        displayOptions.length > 0 &&
        !queryDirty &&
        searchState === "ready"
      ) {
        void Promise.resolve(onQueueSelected(selectedOption.value));
      }
      return;
    }

    // Follow / bookmark the highlighted result (results zone). Bookmarks the title
    // for release notices via the shared media-action router — same path as queue.
    if (listFocused && input.toLowerCase() === "w") {
      if (
        selectedOption &&
        onFollowSelected &&
        displayOptions.length > 0 &&
        !queryDirty &&
        searchState === "ready"
      ) {
        void Promise.resolve(onFollowSelected(selectedOption.value));
      }
      return;
    }

    const canFocusContinueInInput = canFocusIdleRows;

    const resolveFocusedIdleAction = (): ShellAction | null => {
      const row = idleReturnLoopModel?.rows[idleSelectedIndex];
      if (!row?.actionable) return null;
      return resolveIdleRowAction(row.id, idleContext);
    };

    // Calendar: Tab / Shift+Tab cycle the type tabs (All · Anime · TV · Movies ·
    // Tracked). Mode toggle is unavailable while browsing the schedule.
    if (isCalendarView && !commandMode && key.tab) {
      // Cycle type tabs (All · Anime · TV · Movies · Tracked). The hook also clears
      // the day filter, since the new tab has a different day strip.
      cycleCalendarType(key.shift ? -1 : 1);
      setSelectedIndex(0);
      return;
    }

    if (key.tab) {
      onResolve("toggle-mode");
      return;
    }

    // Calendar day strip navigation. From "all days" both arrows enter at today
    // (or the first day) — never jump to the furthest-future day — then ←/→ step
    // to the previous/next day, clamped at the ends (logic owned by the hook).
    if (isCalendarView && calendarDays.length > 0 && key.leftArrow) {
      stepCalendarDay(-1);
      setSelectedIndex(0);
      return;
    }
    if (isCalendarView && calendarDays.length > 0 && key.rightArrow) {
      stepCalendarDay(1);
      setSelectedIndex(0);
      return;
    }
    // `a` toggles all-days ⇄ day-by-day view. Guarded to a focused list with a
    // clean query so it never eats a filter keystroke.
    if (
      isCalendarView &&
      calendarDays.length > 0 &&
      listFocused &&
      !queryDirty &&
      input.toLowerCase() === "a"
    ) {
      toggleCalendarAllDays();
      setSelectedIndex(0);
      return;
    }

    if (key.escape) {
      // Layered step-back: results focus → query focus → clear results → clear
      // query → cancel. Esc first hands the list's focus back to the search box.
      if (isCalendarView && calendarDayFilter !== null) {
        setCalendarDay(null);
        setSelectedIndex(0);
        return;
      }
      if (resultFilterFocused || filterModeOpen) {
        if (resultFilter.length > 0) {
          setResultFilter("");
        }
        setFilterModeOpen(false);
        dispatchFocusZone({ type: "focus-query" });
        return;
      }
      if (listFocused) {
        dispatchFocusZone({ type: "escape" });
        return;
      }
      if (idleFocused) {
        dispatchFocusZone({ type: "escape" });
        return;
      }
      if (options.length > 0 || searchState === "error" || searchState === "loading") {
        clearResults();
        return;
      }
      if (query.length > 0) {
        updateQuery("");
        return;
      }
      onCancel();
      return;
    }

    if (key.return && idleFocused && canFocusContinueInInput) {
      const action = resolveFocusedIdleAction();
      if (action) {
        onResolve(action);
        return;
      }
    }

    if (key.downArrow && idleFocused && idleReturnLoopModel) {
      setIdleSelectedIndex((current) => Math.min(current + 1, idleReturnLoopModel.rows.length - 1));
      return;
    }

    if (key.upArrow && idleFocused) {
      if (idleSelectedIndex > 0) {
        setIdleSelectedIndex((current) => Math.max(0, current - 1));
        return;
      }
      dispatchFocusZone({ type: "escape" });
      return;
    }

    if (key.downArrow && displayOptions.length > 0) {
      if (!listFocused) {
        dispatchFocusZone({ type: "arrow-down" });
        return;
      }
      setSelectedIndex((current) => (current + 1) % displayOptions.length);
      return;
    }

    if (key.upArrow && displayOptions.length > 0) {
      if (!listFocused) {
        dispatchFocusZone({ type: "arrow-up" });
        setSelectedIndex(displayOptions.length - 1);
        return;
      }
      if (boundedSelectedIndex === 0) {
        dispatchFocusZone({ type: "arrow-up" });
        return;
      }
      setSelectedIndex((current) => current - 1);
      return;
    }

    if (key.upArrow && options.length === 0) {
      const history = getSearchHistory();
      if (history.length === 0) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) return;
      if (historyIndex === -1) setDraftQuery(query);
      setHistoryIndex(nextIndex);
      setQuery(history[nextIndex] ?? "");
      return;
    }

    if (key.downArrow && options.length === 0) {
      if (canFocusContinueInInput && historyIndex === -1) {
        dispatchFocusZone({ type: "focus-idle" });
        return;
      }
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setQuery(draftQuery);
        return;
      }
      const history = getSearchHistory();
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      setQuery(history[nextIndex] ?? "");
      return;
    }

    if (idleFocused) {
      dispatchFocusZone({ type: "blur-idle" });
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        {/* Brand · destination · provider · mode · size now live in the single
            AppHeader above; keep only the browse-specific search indicator. */}
        <Box justifyContent="flex-end">
          {searchState === "loading" ? (
            <>
              <InlineDotMatrixLoader variant="flux-columns" active onColor={palette.accent} />
              <Text color={palette.accent}> searching</Text>
            </>
          ) : searchState === "error" ? (
            <Text color={palette.danger}>search failed</Text>
          ) : null}
        </Box>
        {!ultraCompact && (resultStatus.primary || resultStatus.secondary) ? (
          <Box justifyContent="space-between">
            {resultStatus.primary ? (
              <Text color={palette.muted}>{resultStatus.primary}</Text>
            ) : (
              <Box />
            )}
            {resultStatus.secondary ? (
              <Text color={palette.muted}>{resultStatus.secondary}</Text>
            ) : null}
          </Box>
        ) : null}
        {showResultFilterBar ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color={palette.accent}>›› filter mode on</Text>
            <Text color={palette.dim} dimColor>
              {"   narrows loaded results only · Esc closes · use main search for provider filters"}
            </Text>
            <InputField
              label="Narrow results"
              value={resultFilter}
              onChange={(next) => {
                setResultFilter(next);
                setFilterModeOpen(true);
                setSelectedIndex(0);
                dispatchFocusZone({ type: "focus-filter" });
              }}
              onSubmit={() => dispatchFocusZone({ type: "focus-query" })}
              placeholder="type title, year, movie, series, downloaded…"
              focus={resultFilterFocused && !commandMode}
              maxWidth={innerWidth}
              onRedraw={clearShellScreen}
            />
          </Box>
        ) : null}
        {activeFilterBadges.length > 0 && !ultraCompact ? (
          <Box marginTop={1} flexWrap="wrap">
            <Text color={palette.dim}>Filters </Text>
            {activeFilterBadges.map((filter) => (
              <Box key={filter} marginRight={2} flexDirection="column">
                <Text color={palette.muted}>{filter}</Text>
                <Text color={palette.accentSoft}>{"─".repeat(filter.length)}</Text>
              </Box>
            ))}
          </Box>
        ) : null}
        {activeOverlay || (queryDirty && displayOptions.length > 0) ? (
          <Box marginTop={1}>
            <ContextStrip
              items={[
                ...(activeOverlay
                  ? [{ label: activeOverlay.title, tone: "success" } as const]
                  : []),
                ...(queryDirty && displayOptions.length > 0
                  ? [{ label: "Results need refresh", tone: "warning" } as const]
                  : []),
              ]}
            />
          </Box>
        ) : null}

        {isCalendarView ? (
          <Box marginTop={1} flexDirection="row">
            <Text color={palette.accent}>◈ </Text>
            <Text color={palette.text}>schedule</Text>
            <Text color={palette.dim} dimColor>
              {"  ·  ← → day  ·  ⇥ type  ·  ↵ open  ·  / commands"}
            </Text>
          </Box>
        ) : (
          <InputField
            label="Search title"
            value={query}
            onChange={updateQuery}
            onSubmit={handleQuerySubmit}
            placeholder={placeholder}
            focus={!commandMode && !resultFilterFocused && !listFocused}
            hint={
              commandMode
                ? undefined
                : displayOptions.length === 0
                  ? "/filters for guided chips · power tokens: type:series year:2022 rating:8"
                  : undefined
            }
            maxWidth={innerWidth}
            onRedraw={clearShellScreen}
          />
        )}

        {queryDirty &&
        displayOptions.length > 0 &&
        !ultraCompact &&
        !commandMode &&
        !isCalendarView ? (
          <Text color={palette.dim}>Query changed · Press Enter to refresh results</Text>
        ) : null}

        <Box marginTop={1}>
          <Text color={palette.dim} dimColor>
            {"─".repeat(innerWidth)}
          </Text>
        </Box>

        {searchState === "error" && errorMessage && !calendarSurfaceActive ? (
          <Box marginTop={1} flexDirection="column" flexGrow={1}>
            <Text color={palette.danger}>{errorMessage}</Text>
            <Text color={palette.muted} dimColor>
              Press Enter to retry or Esc to clear
            </Text>
          </Box>
        ) : null}

        {isCalendarView && calendarDays.length > 0 && !ultraCompact ? (
          <Box flexDirection="column">
            <CalendarTypeTabs
              activeTab={calendarTypeTab}
              compact={compact}
              maxWidth={listWidth}
              dense={denseChrome}
            />
            <CalendarDayStrip
              days={calendarDays}
              selectedDayKey={calendarDayFilter}
              narrow={viewport.breakpoint === "narrow"}
              maxWidth={listWidth}
              dense={denseChrome}
            />
          </Box>
        ) : null}

        {viewport.breakpoint === "blocked" ? (
          <ResizeBlocker
            columns={viewport.columns}
            rows={viewport.rows}
            minColumns={minColumns}
            minRows={minRows}
            message="Resize terminal to browse results"
          />
        ) : activeOverlay ? (
          <OverlayPanel overlay={activeOverlay} width={innerWidth} />
        ) : displayOptions.length > 0 ? (
          <Box
            flexDirection={showCompanion ? "row" : "column"}
            marginTop={1}
            justifyContent="space-between"
            flexGrow={1}
          >
            {/* Result list */}
            <Box flexDirection="column" width={showCompanion ? listWidth : undefined}>
              {(isCalendarView ? calendarWindow.start : windowStart) > 0 ? (
                <Text color={palette.dim}> ▲ ...</Text>
              ) : null}
              {isCalendarView
                ? visibleCalendarRows.map((row) => (
                    <CalendarScheduleRow
                      key={`${row.option.label}-${row.optionIndex}-${row.timeLabel}`}
                      option={row.option}
                      selected={row.optionIndex === boundedSelectedIndex}
                      rowWidth={rowWidth}
                      timeLabel={row.timeLabel}
                      episodeCode={row.episodeCode}
                      statusLabel={row.statusLabel}
                      statusColor={row.statusColor}
                      statusDim={row.statusDim}
                      statusGlyph={row.statusGlyph}
                      showDayHeader={row.showDayHeader}
                      dayHeaderLabel={row.dayHeaderLabel}
                      weekTag={row.weekTag}
                      showForYouHeader={false}
                      showForYouHeaderOnce={row.showForYouHeaderOnce}
                      isNew={row.isNew}
                      tracked={row.tracked}
                      posterUrl={row.posterUrl}
                    />
                  ))
                : visibleOptions.map((option, index) => {
                    const optionIndex = windowStart + index;
                    const selected = optionIndex === boundedSelectedIndex;
                    // The type column (Series/Movie/Anime) gets its palette tint so a
                    // mixed result set reads by kind at a glance; a previewBadge
                    // (new / wl / …) keeps the neutral row color.
                    const badge = option.previewBadge;
                    const typeMeta =
                      !badge && resultsAreMixed ? option.previewMeta?.[0] : undefined;
                    const metaText = badge ?? typeMeta;
                    const metaWidth = metaText
                      ? Math.min(12, Math.max(6, measureColumns(metaText)))
                      : 0;
                    const titleBudget = Math.max(12, rowWidth - metaWidth - 6);
                    const titleText = padColumnsEnd(
                      truncateLine(option.label, titleBudget),
                      titleBudget,
                    );
                    const metaSegment = metaText
                      ? padColumnsStart(truncateLine(metaText, metaWidth), metaWidth)
                      : "";
                    const titleColor = selected
                      ? listFocused
                        ? palette.text
                        : palette.muted
                      : palette.textDim;
                    const typeKind = typeMeta?.toLowerCase();
                    const metaColor = typeMeta
                      ? contentTintColor(
                          typeKind === "movie"
                            ? "movie"
                            : typeKind === "anime"
                              ? "anime"
                              : "series",
                        )
                      : titleColor;

                    return (
                      <Box
                        key={`${option.label}-${option.detail ?? ""}`}
                        flexDirection="column"
                        width={rowWidth}
                      >
                        <Box width={rowWidth}>
                          <Text wrap="truncate">
                            <Text
                              bold={selected && listFocused}
                              color={
                                selected
                                  ? listFocused
                                    ? palette.accent
                                    : palette.muted
                                  : palette.dim
                              }
                            >
                              {selected ? "▌ " : "  "}
                            </Text>
                            <Text
                              bold={selected && listFocused}
                              dimColor={!selected}
                              color={titleColor}
                            >
                              {titleText}
                            </Text>
                            {metaText ? (
                              <Text dimColor={!selected} color={metaColor}>
                                {` ${metaSegment}`}
                              </Text>
                            ) : null}
                          </Text>
                        </Box>
                      </Box>
                    );
                  })}
              {(
                isCalendarView
                  ? calendarWindow.end < calendarRenderRows.length
                  : windowEnd < displayOptions.length
              ) ? (
                <Text color={palette.dim}> ▼ ...</Text>
              ) : null}
            </Box>

            {/* Companion pane */}
            {showCompanion ? (
              <Box
                key={`browse-companion-${boundedSelectedIndex}-${selectedOption?.label ?? "none"}`}
                marginLeft={2}
                flexDirection="column"
                width={previewWidth}
              >
                {showPreviewRail && previewRailModel ? (
                  <PreviewRail model={previewRailModel} width={previewWidth} poster={poster} />
                ) : (
                  <DetailsSheetUI
                    data={companionDetails}
                    lines={buildDetailsSheetLines(selectedOption, companionDetails.secondary)}
                    width={previewWidth}
                    scrollIndex={0}
                    maxVisibleLines={viewport.breakpoint === "wide" ? 14 : 10}
                  />
                )}
              </Box>
            ) : null}
          </Box>
        ) : calendarSurfaceActive && searchState === "error" && errorMessage ? (
          <CalendarScheduleStatus
            model={buildCalendarErrorState(errorMessage)}
            width={Math.min(innerWidth, 72)}
          />
        ) : calendarSurfaceActive && searchState === "loading" ? (
          <CalendarScheduleStatus
            model={buildCalendarLoadingState()}
            width={Math.min(innerWidth, 72)}
          />
        ) : calendarSurfaceActive && searchState === "ready" ? (
          <CalendarScheduleStatus
            model={buildCalendarEmptyState(calendarEmptyModeLabel)}
            width={Math.min(innerWidth, 72)}
          />
        ) : searchState === "loading" ? (
          // Long request: fill the body with pulsing skeleton rows so the wait
          // reads as "results are coming" rather than a frozen empty surface.
          <Box marginTop={1} flexGrow={1}>
            <SkeletonRows
              rows={4}
              titleWidth={Math.max(16, Math.min(30, innerWidth - 14))}
              label={emptyMessage}
            />
          </Box>
        ) : searchState === "ready" && lastSearchedQuery.length > 0 ? (
          <Box marginTop={2} flexDirection="column" flexGrow={1}>
            <Text color={palette.dim}>{`◌  no results for "${lastSearchedQuery}"  `}</Text>
            <Text color={palette.dim} dimColor>
              try a different title or browse by genre
            </Text>
          </Box>
        ) : (
          <Box marginTop={1} flexGrow={1} flexDirection="column">
            <Text color={palette.dim}>{emptyMessage}</Text>
            {emptyMessage.includes("trending") ? (
              <Text color={palette.dim} dimColor>
                Use <Text color={palette.dim}>year:2022</Text> or{" "}
                <Text color={palette.dim}>type:anime</Text> to narrow ·{" "}
                <Text color={palette.dim}>/filters</Text> for all tokens
              </Text>
            ) : null}
            {!commandMode &&
            idleReturnLoopModel &&
            (!viewport.ultraCompact || idleReturnLoopModel.rows.length > 0) ? (
              <Box flexDirection="column" marginTop={1} gap={0}>
                <Text color={palette.dim} bold>
                  {idleReturnLoopModel.heading}
                </Text>
                {idleReturnLoopModel.rows.map((row) => (
                  <Text key={row.id} color={row.focused ? palette.text : palette.muted}>
                    {row.focused ? <Text color={palette.accent}>{"▌ "}</Text> : "  "}
                    <Text color={row.glyphColor}>{row.glyph}</Text>{" "}
                    <Text color={row.focused ? palette.text : palette.textDim} bold={row.focused}>
                      {row.title}
                    </Text>
                    {row.meta ? <Text color={palette.dim}>{`  ${row.meta}`}</Text> : null}
                    {row.hint ? (
                      <Text color={row.focused ? palette.accent : palette.dim}>
                        {` · ${row.hint}`}
                      </Text>
                    ) : null}
                  </Text>
                ))}
              </Box>
            ) : null}
          </Box>
        )}
      </Box>

      {commandMode ? (
        <CommandPalette
          input={commandInput}
          cursor={commandEditor.cursor}
          commands={commands}
          highlightedIndex={highlightedCommandIndex}
          maxVisible={getBrowseCommandPaletteMaxVisible(
            viewport.rows,
            Boolean(resultSubtitle && !viewport.ultraCompact),
            Boolean(activeFilterBadges.length > 0 && !viewport.ultraCompact),
          )}
          width={innerWidth}
        />
      ) : null}

      {_settings?.discoverShowOnStartup && (
        <Text color={palette.dim}>/ recommendation · based on your history</Text>
      )}
      {(() => {
        const allBrowseFooterActions: readonly FooterAction[] = [
          {
            key: "enter",
            label: listFocused ? "play" : options.length > 0 && !queryDirty ? "open" : "search",
            action: "search",
            primary: true,
          },
          {
            key: "↑↓",
            label: listFocused ? "navigate · ↑ top → search" : "navigate",
            action: "search",
          },
          ...(listFocused && searchState === "ready"
            ? [{ key: "i", label: "details", action: "details" as const }]
            : options.length > 0 && !queryDirty && searchState === "ready"
              ? [
                  { key: "^O", label: "details", action: "details" as const },
                  { key: "ctrl+f", label: "filter", action: "filters" as const },
                ]
              : []),
          {
            key: "tab",
            label: getCommandLabel(commands, "toggle-mode", "switch mode"),
            action: "toggle-mode",
          },
          { key: "/", label: "commands", action: "command-mode" },
          ...(onLoadDiscovery
            ? [{ key: "ctrl+t", label: "trending", action: "trending" as const }]
            : []),
          ...(options.length > 0 && !queryDirty
            ? [{ key: "^D", label: "download", action: "download" as const }]
            : []),
          ...(onQueueSelected && options.length > 0 && !queryDirty
            ? [{ key: "q", label: "up next", action: "playlist" as const }]
            : []),
          ...(onFollowSelected && options.length > 0 && !queryDirty
            ? [{ key: "w", label: "follow", action: "follow" as const }]
            : []),
          { key: "esc", label: "clear/back", action: "quit" },
        ];
        const visibleBrowseFooterActions = selectFooterActions(
          allBrowseFooterActions,
          effectiveFooterMode,
          viewport.columns,
          viewport.breakpoint === "narrow" ? 3 : 5,
        );
        return (
          <ShellFooter
            taskLabel={options.length > 0 && !queryDirty ? "Browse" : "Search"}
            mode={effectiveFooterMode}
            commandMode={commandMode}
            actions={visibleBrowseFooterActions}
            terminalWidth={viewport.columns}
          />
        );
      })()}
    </Box>
  );
}

export function openBrowseShell<T>({
  mode,
  provider,
  initialQuery,
  initialResults,
  initialResultSubtitle,
  initialSelectedIndex,
  initialCalendarTypeTab,
  placeholder,
  commands,
  providerOptions,
  loadHistoryPanel,
  loadDiagnosticsPanel,
  loadHelpPanel,
  loadAboutPanel,
  onChangeProvider,
  onSearch,
  onLoadDiscovery,
  onLoadRecommendations,
  footerMode,
  settings,
  settingsSeriesProviderOptions,
  settingsAnimeProviderOptions,
  onSaveSettings,
  onQueueSelected,
  onFollowSelected,
  idleContext,
}: {
  mode: "series" | "anime";
  provider: string;
  initialQuery?: string;
  initialResults?: readonly BrowseShellOption<T>[];
  initialResultSubtitle?: string;
  initialSelectedIndex?: number;
  initialCalendarTypeTab?: CalendarTypeTab;
  placeholder: string;
  commands: readonly ResolvedAppCommand[];
  providerOptions?: readonly ShellPickerOption<string>[];
  loadHistoryPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadDiagnosticsPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadHelpPanel?: () => Promise<readonly ShellPanelLine[]>;
  loadAboutPanel?: () => Promise<readonly ShellPanelLine[]>;
  onChangeProvider?: (providerId: string) => Promise<void>;
  onSearch: (query: string) => Promise<BrowseShellSearchResponse<T>>;
  onLoadDiscovery?: () => Promise<BrowseShellSearchResponse<T>>;
  onLoadRecommendations?: () => Promise<BrowseShellSearchResponse<T>>;
  footerMode?: ShellFooterMode;
  settings?: KitsuneConfig;
  settingsSeriesProviderOptions?: readonly ShellPickerOption<string>[];
  settingsAnimeProviderOptions?: readonly ShellPickerOption<string>[];
  onSaveSettings?: (next: KitsuneConfig) => Promise<void>;
  onQueueSelected?: (value: T) => Promise<void> | void;
  onFollowSelected?: (value: T) => Promise<void> | void;
  idleContext?: import("./types").BrowseIdleContext;
}): Promise<BrowseShellResult<T>> {
  const session = mountRootContent<BrowseShellResult<T>>({
    kind: "browse",
    renderContent: (finish) => (
      <BrowseShell
        mode={mode}
        provider={provider}
        initialQuery={initialQuery}
        initialResults={initialResults}
        initialResultSubtitle={initialResultSubtitle}
        initialSelectedIndex={initialSelectedIndex}
        initialCalendarTypeTab={initialCalendarTypeTab}
        placeholder={placeholder}
        commands={commands}
        providerOptions={providerOptions}
        loadHistoryPanel={loadHistoryPanel}
        loadDiagnosticsPanel={loadDiagnosticsPanel}
        loadHelpPanel={loadHelpPanel}
        loadAboutPanel={loadAboutPanel}
        onChangeProvider={onChangeProvider}
        onSearch={onSearch}
        onLoadDiscovery={onLoadDiscovery}
        onLoadRecommendations={onLoadRecommendations}
        footerMode={footerMode}
        settings={settings}
        settingsSeriesProviderOptions={settingsSeriesProviderOptions}
        settingsAnimeProviderOptions={settingsAnimeProviderOptions}
        onSaveSettings={onSaveSettings}
        onQueueSelected={onQueueSelected}
        onFollowSelected={onFollowSelected}
        idleContext={idleContext}
        onResolve={(action) => finish({ type: "action", action })}
        onSubmit={(value) => finish({ type: "selected", value })}
        onCancel={() => finish({ type: "cancelled" })}
      />
    ),
    fallbackValue: { type: "cancelled" },
  });

  return session.result;
}
