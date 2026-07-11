import { createLatestRequestGate, runBrowseMutation } from "@/app-shell/browse-async";
import { browseOptionFromMediaItem } from "@/app-shell/browse-option-from-media-item";
import { recordKeystroke, recordRender } from "@/app-shell/diagnostics/render-trace";
import { useCalendarNow } from "@/app-shell/hooks/use-calendar-now";
import { useSettledValue } from "@/app-shell/hooks/use-settled-value";
import { useLineEditor } from "@/app-shell/line-editor";
import { addSearchQuery, getSearchHistory } from "@/app-shell/search-history";
import type { SearchResult, ShellMode } from "@/domain/types";
import { fetchTitleDetail, peekTitleDetail } from "@/services/catalog/TitleDetailService";
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
  buildBrowseDetailsSheetSeed,
  formatBrowseShellError,
  MIN_RESULTS_FOR_LOCAL_FILTER,
  PREVIEW_POSTER_ROWS,
} from "./browse-shell-view";
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
import { buildDetailsSheet } from "./details-sheet.model";
import { requestHardExit } from "./graceful-exit";
import { useCalendarState } from "./hooks/use-calendar-state";
import { deleteAllKittyImages } from "./image-pane";
import { resolveBrowseBindingEffect, resolveKeybinding } from "./keybinding-runtime";
import { buildFooterActionsFromBindings } from "./keybindings";
import {
  getBrowseChromeRows,
  getBrowseCommandPaletteMaxVisible,
  getBrowseListMaxVisible,
} from "./layout-policy";
import type { BrowseOverlay } from "./overlay-panel";
import { OverlayPanel } from "./overlay-panel";
import { computeMediaListRowLayout } from "./primitives/list-row-layout";
import { ListRow } from "./primitives/ListRow";
import {
  listRowStatusColumn,
  listRowTitleColumn,
  type ListRowColumn,
} from "./primitives/ListRow.model";
import { PreviewRail } from "./primitives/PreviewRail";
import { shouldRenderPreviewRail } from "./primitives/PreviewRail.model";
import { StateBlock } from "./primitives/StateBlock";
import { mountRootContent } from "./root-content-state";
import {
  getNotificationDetailsPending,
  subscribeNotificationDetails,
  takeNotificationDetailsItem,
} from "./root-overlay-bridge";
import { InlineSakuraLoader } from "./SakuraLoader";
import {
  getCommandAutocompleteTarget,
  getCommandMatches,
  getHighlightedCommand,
} from "./shell-command-model";
import { CommandPalette } from "./shell-command-ui";
import { getCommandLabel, InputField } from "./shell-frame";
import { ContextStrip, ResizeBlocker, ShellFooter, selectFooterActions } from "./shell-primitives";
import { getWindowStart, measureColumns } from "./shell-text";
import { palette } from "./shell-theme";
import { SkeletonRows } from "./skeleton";
import {
  toShellAction,
  type FooterAction,
  type BrowseShellOption,
  type BrowseShellResult,
  type BrowseShellSearchResponse,
  type ShellAction,
} from "./types";
import { usePosterPreview } from "./use-poster-preview";
import { useDebouncedViewportPolicy } from "./use-viewport-policy";

function clearShellScreen() {
  if (process.stdout.isTTY) {
    deleteAllKittyImages();
  }
}

function browseIdleHint(mode: ShellMode): string {
  if (mode === "youtube") {
    return "Search for a channel or video — or try /trending";
  }
  if (mode === "anime") {
    return "Search for an anime — or try /trending";
  }
  return "Search for a title — or try /trending to see what's popular";
}

function browseEmptyDetail(mode: ShellMode, message: string): string | undefined {
  if (!message.includes("trending")) return undefined;
  if (mode === "youtube") {
    return "Use type:playlist to narrow · /filters for all tokens";
  }
  return "Use year:2022 or type:anime to narrow · /filters for all tokens";
}

function browseFilterPlaceholder(mode: ShellMode): string {
  if (mode === "youtube") {
    return "type channel, playlist, video, downloaded…";
  }
  if (mode === "anime") {
    return "type title, year, anime, downloaded…";
  }
  return "type title, year, movie, series, downloaded…";
}

export function BrowseShell<T>({
  mode,
  provider,
  initialQuery,
  initialResults,
  initialResultSubtitle,
  initialSelectedIndex,
  initialCalendarTypeTab,
  placeholder,
  commands,
  onSearch,
  onLoadDiscovery,
  onLoadRecommendations,
  settings,
  onQueueSelected,
  onWatchlistSelected,
  onFollowSelected,
  onPlayTrailer,
  onOpenLink,
  onResolve,
  onSubmit,
  onCancel,
  idleContext,
}: {
  mode: ShellMode;
  provider: string;
  initialQuery?: string;
  initialResults?: readonly BrowseShellOption<T>[];
  initialResultSubtitle?: string;
  initialSelectedIndex?: number;
  initialCalendarTypeTab?: CalendarTypeTab;
  placeholder: string;
  commands: readonly ResolvedAppCommand[];
  onSearch: (query: string) => Promise<BrowseShellSearchResponse<T>>;
  onLoadDiscovery?: () => Promise<BrowseShellSearchResponse<T>>;
  onLoadRecommendations?: () => Promise<BrowseShellSearchResponse<T>>;
  settings?: KitsuneConfig;
  onQueueSelected?: (value: T) => Promise<void> | void;
  onWatchlistSelected?: (value: T) => Promise<void> | void;
  onFollowSelected?: (value: T) => Promise<void> | void;
  onPlayTrailer?: (url: string) => void;
  onOpenLink?: (url: string) => void;
  onResolve: (action: ShellAction) => void;
  onSubmit: (value: T) => void;
  onCancel: () => void;
  idleContext?: import("./types").BrowseIdleContext;
}) {
  recordRender("browse");
  const viewport = useDebouncedViewportPolicy("browse", {
    zen: settings?.zenMode,
  });
  const [query, setQuery] = useState(initialQuery ?? "");
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [highlightedCommandIndex, setHighlightedCommandIndex] = useState(0);
  // Transient confirmation for row actions (follow / queue / download) — without it,
  // following a title looked like a no-op even though it persisted.
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const actionFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashActionFeedback = useCallback((message: string) => {
    setActionFeedback(message);
    if (actionFeedbackTimer.current) clearTimeout(actionFeedbackTimer.current);
    actionFeedbackTimer.current = setTimeout(() => setActionFeedback(null), 2500);
  }, []);
  useEffect(
    () => () => {
      if (actionFeedbackTimer.current) clearTimeout(actionFeedbackTimer.current);
    },
    [],
  );
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
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">(
    initialResults && initialResults.length > 0 ? "ready" : "idle",
  );
  const [lastSearchedQuery, setLastSearchedQuery] = useState(
    initialResults && initialResults.length > 0 ? (initialQuery ?? "") : "",
  );
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftQuery, setDraftQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState(() => browseIdleHint(mode));
  const [activeFilterBadges, setActiveFilterBadges] = useState<readonly string[]>([]);
  const [resultFilter, setResultFilter] = useState("");
  const [filterModeOpen, setFilterModeOpen] = useState(false);
  // Focus zones: query (text) → list (bare hotkeys) → filter (local narrow) → idle.
  // See browse-focus-zone.ts and .docs/ux-architecture.md.
  const [focusZone, setFocusZone] = useState<BrowseFocusZone>(() => {
    // The calendar surface has no search box, so the `query` zone is a dead zone:
    // arrows would only switch the (invisible) zone and the FIRST ↑/↓ would do
    // nothing visible. Boot straight into `list` so the schedule owns the keyboard
    // immediately. Mirrored by the focus effect below for route-loaded calendars.
    const bootsIntoCalendar =
      (initialResults ?? []).some(
        (opt) => opt.calendar !== undefined || opt.previewGroup !== undefined,
      ) ||
      (initialResultSubtitle ?? "").includes("schedule") ||
      (initialResultSubtitle ?? "").includes("airing today");
    if (bootsIntoCalendar) return "list";
    return createInitialBrowseFocusZone({
      startIdle: !!(
        settings?.minimalMode &&
        idleContext?.continueWatching?.titleId &&
        (!initialResults || initialResults.length === 0)
      ),
    });
  });
  const [idleSelectedIndex, setIdleSelectedIndex] = useState(0);
  const focusZoneContextRef = useRef<BrowseFocusZoneContext>({
    hasResults: false,
    hasFilterBar: false,
    canFocusIdle: false,
    selectedIndex: 0,
  });
  const searchRequestGateRef = useRef(createLatestRequestGate());
  const detailRequestGateRef = useRef(createLatestRequestGate());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
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
  const calendarNow = useCalendarNow(isCalendarView);

  // Calendar UI state owns the active type and one concrete date scope.
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
  const { reset: resetCalendar, cycleType: cycleCalendarType, stepDay: stepCalendarDay } = calendar;

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
    if (rawQuery.length === 0 || (trimmed.length === 0 && !hasFilters)) return;
    const filterBadges = describeBrowseResultFilters(parsedQuery.filters);

    const requestId = searchRequestGateRef.current.begin();
    setSearchState("loading");
    setFocusZone("query");
    setErrorMessage(null);
    setEmptyMessage("Searching…");
    resetCalendar();

    try {
      const response = await onSearch(rawQuery);
      if (!searchRequestGateRef.current.isCurrent(requestId)) return;
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
      if (!searchRequestGateRef.current.isCurrent(requestId)) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(formatBrowseShellError(error));
      setEmptyMessage("Search failed.");
    }
  }, [query, onSearch, resetCalendar]);

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
    if (!onLoadDiscovery) return;

    const requestId = searchRequestGateRef.current.begin();
    setQuery("");
    setSearchState("loading");
    setErrorMessage(null);
    setEmptyMessage("Loading trending…");
    resetCalendar();

    try {
      const response = await onLoadDiscovery();
      if (!searchRequestGateRef.current.isCurrent(requestId)) return;

      setLastSearchedQuery("");
      setOptions(response.options);
      setSelectedIndex(0);
      setResultSubtitle(response.subtitle);
      setEmptyMessage(response.emptyMessage ?? "Trending is unavailable right now.");
      setActiveFilterBadges([]);
      setSearchState("ready");
    } catch (error) {
      if (!searchRequestGateRef.current.isCurrent(requestId)) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(formatBrowseShellError(error));
      setEmptyMessage("Trending failed.");
    }
  };

  const loadRecommendations = async () => {
    if (!onLoadRecommendations) return;

    const requestId = searchRequestGateRef.current.begin();
    setQuery("");
    setSearchState("loading");
    setErrorMessage(null);
    setEmptyMessage("Loading recommendations…");
    resetCalendar();

    try {
      const response = await onLoadRecommendations();
      if (!searchRequestGateRef.current.isCurrent(requestId)) return;

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
            if (!mountedRef.current || !searchRequestGateRef.current.isCurrent(requestId)) {
              return undefined;
            }
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
      if (!searchRequestGateRef.current.isCurrent(requestId)) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(formatBrowseShellError(error));
      setEmptyMessage("Recommendations failed.");
    }
  };

  const closeOverlay = () => {
    detailRequestGateRef.current.invalidate();
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

  // Preview-side work — network poster fetch + chafa/kitty render and secondary
  // detail resolution — is deferred until the selection settles. During rapid
  // ↑/↓ only the highlight (boundedSelectedIndex) moves, which is cheap; the heavy
  // per-row work must NOT fire on every intermediate row or it floods the main
  // thread and Ink's frame writes, making navigation feel blocked and dropping
  // keypresses. Calendar feels this worst: its lists are large (the "All" tab
  // aggregates everything) and every row carries a poster, so without this gate
  // the highlight appears stuck while the side panel/poster churn catches up.
  // `selectedOption` stays live for input handlers (Enter/details/follow/queue);
  // only the preview surface reads `settledOption`. The settle window (see
  // PREVIEW_SETTLE_MS) means a run of ↑/↓ presses spawns no poster subprocess
  // until navigation rests, keeping the event loop free to service keypresses.
  const settledOption = useSettledValue(selectedOption);
  // True while the highlight is ahead of the settled preview, i.e. actively
  // navigating. Used to suppress the heavy poster block from intermediate frames.
  const navigating = selectedOption !== settledOption;

  const openDetailsOverlay = useCallback(
    (option?: BrowseShellOption<T>) => {
      const resolved = option ?? selectedOption;
      if (!resolved) return;
      const detailRequestId = detailRequestGateRef.current.begin();
      const panel = buildBrowseDetailsPanel(resolved);
      setCommandMode(false);
      setFocusZone("query");

      const seed = buildBrowseDetailsSheetSeed(resolved);
      const value = resolved.value as unknown as Partial<SearchResult>;
      const titleId = typeof value?.id === "string" ? value.id : undefined;
      const cached = titleId ? (peekTitleDetail(titleId, seed.type) ?? null) : null;

      setActiveOverlay({
        type: "details",
        title: panel.title,
        subtitle: panel.subtitle,
        lines: [],
        sheet: buildDetailsSheet({ seed, detail: cached, history: null, availability: null }),
        seasonsExpanded: false,
        imageUrl: panel.imageUrl,
        loading: false,
        scrollIndex: 0,
      });

      // Gap-fill only when cold (peek miss); the fetch rides the shared TMDB cache.
      if (titleId && !cached) {
        void (async () => {
          try {
            const detail = await fetchTitleDetail(titleId, seed.type);
            setActiveOverlay((current) =>
              detailRequestGateRef.current.isCurrent(detailRequestId) &&
              current &&
              current.type === "details"
                ? {
                    ...current,
                    sheet: buildDetailsSheet({
                      seed,
                      detail,
                      history: null,
                      availability: null,
                      seasonsExpanded: current.seasonsExpanded,
                    }),
                  }
                : current,
            );
          } catch {
            // best-effort; the seeded header/synopsis stay, skeletons resolve to "—"
          }
        })();
      }
    },
    [selectedOption],
  );

  const runMutationWithFeedback = useCallback(
    (operation: () => Promise<void> | void, successMessage: string, failurePrefix: string) => {
      void runBrowseMutation(operation).then((result) => {
        flashActionFeedback(result.ok ? successMessage : `${failurePrefix}: ${result.message}`);
        return undefined;
      });
    },
    [flashActionFeedback],
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

  // Calendar owns the keyboard: there is no search box to focus, so `query` is a
  // dead zone where the first arrow key only flips an invisible focus state and
  // appears to do nothing. Whenever the schedule is showing rows, force `list`
  // focus so ↑/↓ navigate on the first press and re-entering from a closed
  // details overlay (which sets `query`) never strands navigation again.
  useEffect(() => {
    if (isCalendarView && displayOptions.length > 0 && !isBrowseListFocused(focusZone)) {
      setFocusZone("list");
    }
  }, [isCalendarView, displayOptions.length, focusZone]);

  useEffect(() => {
    const primaryData = buildDetailsPanelDataFromBrowseOption(settledOption);
    setCompanionDetails(primaryData);
    let cancelled = false;
    void (async () => {
      await Bun.sleep(32);
      if (cancelled) return;
      const secondary = resolveBrowseDetailsSecondary(settledOption, { providerName: provider });
      setCompanionDetails((current) => ({
        ...current,
        primary: primaryData.primary,
        secondary,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, settledOption]);

  const { compact, ultraCompact, minColumns, minRows } = viewport;
  // Short terminals: collapse schedule chrome margins so the list keeps its rows.
  const denseChrome = viewport.rows < 28;
  const browseBreakpoint = viewport.breakpoint;
  const wideBrowse = browseBreakpoint === "wide";
  const mediumBrowse = browseBreakpoint === "medium";
  const showCompanionLayout = wideBrowse || mediumBrowse;
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
  // Browse option rows share the history/library row primitive: flex title +
  // optional right-aligned meta. No episode/recency columns here.
  const browseRowLayout = computeMediaListRowLayout(rowWidth, { hasEpisode: false });
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
  const companionBesideList = showCompanion && wideBrowse && !mediumBrowse;
  const { poster, posterState: posterPreviewState } = usePosterPreview(
    settledOption?.previewImageUrl ?? undefined,
    {
      rows: PREVIEW_POSTER_ROWS,
      cols: Math.max(14, Math.min(20, previewWidth - 6)),
      enabled: Boolean(settledOption?.previewImageUrl),
      // `settledOption` already absorbs the rapid-navigation burst, so the poster
      // hook only needs a tiny guard rather than re-debouncing on top of it.
      debounceMs: 16,
      variant: "detail",
    },
  );
  const mappedPosterState = mapPosterPreviewState({
    hasPosterPath: Boolean(settledOption?.previewImageUrl),
    poster,
    posterState: posterPreviewState,
  });
  const previewRailModel = isCalendarView
    ? buildCalendarPreviewRailModel(
        settledOption as BrowseShellOption<SearchResult> | undefined,
        mappedPosterState,
      )
    : buildPreviewRailModelFromBrowseOption(settledOption, mappedPosterState);
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
  //
  // Memoized deliberately: building the rows runs an O(n log n) chronological sort
  // (Date.parse per comparison) plus per-row day-header/week-tag/isNew work across
  // the WHOLE schedule. Without this it reran on every render — including every ↑/↓
  // keystroke (setSelectedIndex) — and Ink renders synchronously on the main thread,
  // so that work blocked keypress handling and made calendar nav feel laggy / drop
  // arrows. Selection is intentionally NOT a dependency: navigation only re-slices the
  // window + flips the `selected` flag below, both cheap.
  const lastCalendarVisitAt = settings?.lastCalendarVisitAt ?? 0;
  const calendarRenderRows = useMemo(
    () =>
      isCalendarView
        ? buildCalendarRenderRows(
            displayOptions as readonly BrowseShellOption<import("@/domain/types").SearchResult>[],
            0,
            displayOptions.length,
            calendarNow,
            calendarDayFilter,
            false,
            lastCalendarVisitAt,
          )
        : [],
    [isCalendarView, displayOptions, calendarNow, calendarDayFilter, lastCalendarVisitAt],
  );
  const calendarWindow = windowCalendarRowsByLines(
    calendarRenderRows,
    boundedSelectedIndex,
    maxVisible,
  );
  const visibleCalendarRows = calendarRenderRows.slice(calendarWindow.start, calendarWindow.end);

  useInput((input, key) => {
    recordKeystroke("browse", key.upArrow ? "up" : key.downArrow ? "down" : input);
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

      if (activeOverlay.type === "details" && activeOverlay.sheet) {
        if (input.toLowerCase() === "s") {
          setActiveOverlay((current) =>
            current && current.type === "details"
              ? { ...current, seasonsExpanded: !current.seasonsExpanded }
              : current,
          );
          return;
        }
        if (input.toLowerCase() === "t" && activeOverlay.sheet.trailerUrl) {
          onPlayTrailer?.(activeOverlay.sheet.trailerUrl);
          return;
        }
        if (input.toLowerCase() === "l" && activeOverlay.sheet.links.items[0]) {
          onOpenLink?.(activeOverlay.sheet.links.items[0].url);
          return;
        }
        // Actions advertised in the sheet footer, dispatched against the highlighted row.
        if (input.toLowerCase() === "w" && selectedOption && onWatchlistSelected) {
          runMutationWithFeedback(
            () => onWatchlistSelected(selectedOption.value),
            `Watchlisted ${selectedOption.label}`,
            "Could not watchlist",
          );
          return;
        }
        if (input.toLowerCase() === "q" && selectedOption && onQueueSelected) {
          runMutationWithFeedback(
            () => onQueueSelected(selectedOption.value),
            `Queued ${selectedOption.label}`,
            "Could not queue",
          );
          return;
        }
        if (input.toLowerCase() === "d" && selectedOption && searchState === "ready") {
          onResolve("download");
          return;
        }
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

    if (!commandMode && !resultFilterFocused && !filterModeOpen && listFocused) {
      const listBinding = resolveKeybinding(["browse"], input, key);
      if (listBinding?.id === "help") {
        onResolve("help");
        return;
      }
    }

    if (!commandMode && listFocused) {
      const listBinding = resolveKeybinding(["browse"], input, key);
      const listEffect = listBinding ? resolveBrowseBindingEffect(listBinding) : null;
      if (listEffect?.kind === "open-up-next") {
        onResolve("up-next");
        return;
      }
      if (
        listEffect &&
        (listEffect.kind === "add-to-up-next" ||
          listEffect.kind === "add-to-watchlist" ||
          listEffect.kind === "follow") &&
        selectedOption &&
        displayOptions.length > 0 &&
        !queryDirty &&
        searchState === "ready"
      ) {
        if (listEffect.kind === "add-to-up-next" && onQueueSelected) {
          runMutationWithFeedback(
            () => onQueueSelected(selectedOption.value),
            `Added ${selectedOption.label} to Up Next`,
            "Could not queue",
          );
          return;
        }
        if (listEffect.kind === "add-to-watchlist" && onWatchlistSelected) {
          runMutationWithFeedback(
            () => onWatchlistSelected(selectedOption.value),
            `Watchlisted ${selectedOption.label}`,
            "Could not watchlist",
          );
          return;
        }
        if (listEffect.kind === "follow" && onFollowSelected) {
          runMutationWithFeedback(
            () => onFollowSelected(selectedOption.value),
            `Following ${selectedOption.label}`,
            "Could not follow",
          );
          return;
        }
      }
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

    if (listFocused && input.toLowerCase() === "m" && selectedOption && searchState === "ready") {
      onResolve("menu");
      return;
    }

    if (listFocused && input.toLowerCase() === "n" && key.shift) {
      onResolve("notifications");
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

    // Calendar remains date-scoped: arrows move only between available dates.
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
    if (key.escape) {
      // Layered step-back: results focus → query focus → clear results → clear
      // query → cancel. Esc first hands the list's focus back to the search box.
      //
      // Calendar is self-contained: it has no query box to fall back into, so
      // Escape closes it directly instead of entering a hidden focus state.
      if (isCalendarView) {
        clearResults();
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
        if (isCalendarView) {
          // The calendar has no search box above the list to escape up into, so
          // dispatching focus away just flips the footer to an invisible zone (the
          // "moving to an invisible row" bug). Wrap to the last row instead — this
          // mirrors the downArrow wrap and keeps focus on the schedule.
          setSelectedIndex(displayOptions.length - 1);
          return;
        }
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
            <InlineSakuraLoader label="searching" active />
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
              placeholder={browseFilterPlaceholder(mode)}
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
            flexDirection={companionBesideList ? "row" : "column"}
            marginTop={1}
            justifyContent="space-between"
            flexGrow={1}
          >
            {/* Result list */}
            <Box flexDirection="column" width={companionBesideList ? listWidth : undefined}>
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
                    // The type column (Series/Movie/Anime) reads as quiet muted meta
                    // when the set is mixed; a previewBadge (new / wl / …) takes
                    // precedence. Identity/focus is carried by the row, not a tint.
                    const badge = option.previewBadge;
                    const typeMeta =
                      !badge && resultsAreMixed ? option.previewMeta?.[0] : undefined;
                    const metaText = badge ?? typeMeta;
                    const columns: ListRowColumn[] = [
                      listRowTitleColumn(option.label, browseRowLayout.titleWidth),
                    ];
                    if (metaText) {
                      const metaWidth = Math.min(12, Math.max(6, measureColumns(metaText)));
                      columns.push(listRowStatusColumn(metaText, metaWidth, palette.muted, true));
                    }
                    return (
                      <ListRow
                        key={`${option.label}-${option.detail ?? ""}`}
                        selected={selected && listFocused}
                        rowWidth={rowWidth}
                        flexColumnIndex={browseRowLayout.flexColumnIndex}
                        columns={columns}
                      />
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
                // Stable key: a selection-derived key here force-UNMOUNTED and
                // remounted the whole preview pane (PreviewRail + poster + details)
                // on every ↑/↓, synchronously on the keypress path — a primary
                // cause of calendar nav feeling like it "registers late". The pane
                // is now reconciled (cheap, memoized) and the poster hook clears
                // stale images on fetch, so no remount is needed for correctness.
                key="browse-companion"
                marginLeft={companionBesideList ? 2 : 0}
                marginTop={companionBesideList ? 0 : 1}
                flexDirection="column"
                width={previewWidth}
              >
                {showPreviewRail && previewRailModel ? (
                  <PreviewRail
                    model={previewRailModel}
                    width={previewWidth}
                    // While navigating, suppress the heavy chafa color block: the
                    // companion shares output lines with the (shifting) list, so Ink
                    // re-emits the whole block on every keystroke. Kitty posters are
                    // a tiny placeholder drawn out-of-band, so they are left in place
                    // (suppressing them would orphan the on-screen image). reserveRows
                    // keeps the slot height fixed so the placeholder -> image swap on
                    // settle does not reflow the panel.
                    poster={navigating && poster.kind === "text" ? undefined : poster}
                    reserveRows={PREVIEW_POSTER_ROWS}
                  />
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
            <StateBlock
              model={{
                kind: "empty",
                title: `No results for "${lastSearchedQuery}"`,
                detail: "Try a different title, adjust filters, or browse by genre.",
              }}
              width={Math.min(innerWidth, 72)}
            />
          </Box>
        ) : searchState === "error" ? (
          <Box marginTop={1} flexGrow={1}>
            <StateBlock
              model={{
                kind: "error",
                title: "Search failed",
                detail: errorMessage ?? "Something went wrong while loading results.",
                actions: [
                  { id: "retry", label: "Retry search", shortcut: "Enter" },
                  { id: "clear", label: "Clear and start over", shortcut: "Esc", tone: "muted" },
                ],
              }}
              width={Math.min(innerWidth, 72)}
            />
          </Box>
        ) : (
          <Box marginTop={1} flexGrow={1} flexDirection="column">
            <StateBlock
              model={{
                kind: "empty",
                title: emptyMessage,
                detail: browseEmptyDetail(mode, emptyMessage),
              }}
              width={Math.min(innerWidth, 72)}
            />
            {!commandMode &&
            idleReturnLoopModel &&
            (!viewport.ultraCompact || idleReturnLoopModel.rows.length > 0) ? (
              <Box flexDirection="column" marginTop={1} gap={0}>
                <Text color={palette.dim} bold>
                  {idleReturnLoopModel.heading}
                </Text>
                {idleReturnLoopModel.rows.map((row) => (
                  <Text
                    key={row.id}
                    backgroundColor={row.focused ? palette.accentFill : undefined}
                    color={row.focused ? palette.text : palette.muted}
                  >
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

      {settings?.discoverShowOnStartup && (
        <Text color={palette.dim}>/ recommendation · based on your history</Text>
      )}
      {actionFeedback ? <Text color={palette.ok}>{`✓ ${actionFeedback}`}</Text> : null}
      {(() => {
        const browseBindingIds: string[] = [
          ...(listFocused && searchState === "ready" ? ["browse-details"] : []),
          ...(options.length > 0 && !queryDirty && searchState === "ready" && !listFocused
            ? ["browse-details-ctrl", "browse-filter"]
            : []),
          "browse-mode",
          ...(onLoadDiscovery ? ["browse-trending"] : []),
          ...(options.length > 0 && !queryDirty
            ? [
                "browse-download",
                ...(onQueueSelected ? ["browse-queue"] : []),
                ...(onWatchlistSelected ? ["browse-watchlist"] : []),
                ...(onFollowSelected ? ["browse-follow"] : []),
              ]
            : []),
        ];
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
          ...buildFooterActionsFromBindings("browse", {
            ids: browseBindingIds,
            tail: false,
            actions: {
              "browse-details": "details",
              "browse-details-ctrl": "details",
              "browse-filter": "filters",
              "browse-mode": "toggle-mode",
              "browse-trending": "trending",
              "browse-download": "download",
              "browse-queue": "up-next",
              "browse-watchlist": "bookmark",
              "browse-follow": "follow",
            },
            overrides: {
              "browse-mode": {
                label: getCommandLabel(commands, "toggle-mode", "switch mode"),
              },
            },
          }),
          { key: "/", label: "commands", action: "command-mode" },
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
  onSearch,
  onLoadDiscovery,
  onLoadRecommendations,
  settings,
  onQueueSelected,
  onWatchlistSelected,
  onFollowSelected,
  onPlayTrailer,
  onOpenLink,
  idleContext,
}: {
  mode: ShellMode;
  provider: string;
  initialQuery?: string;
  initialResults?: readonly BrowseShellOption<T>[];
  initialResultSubtitle?: string;
  initialSelectedIndex?: number;
  initialCalendarTypeTab?: CalendarTypeTab;
  placeholder: string;
  commands: readonly ResolvedAppCommand[];
  onSearch: (query: string) => Promise<BrowseShellSearchResponse<T>>;
  onLoadDiscovery?: () => Promise<BrowseShellSearchResponse<T>>;
  onLoadRecommendations?: () => Promise<BrowseShellSearchResponse<T>>;
  settings?: KitsuneConfig;
  onQueueSelected?: (value: T) => Promise<void> | void;
  onWatchlistSelected?: (value: T) => Promise<void> | void;
  onFollowSelected?: (value: T) => Promise<void> | void;
  onPlayTrailer?: (url: string) => void;
  onOpenLink?: (url: string) => void;
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
        onSearch={onSearch}
        onLoadDiscovery={onLoadDiscovery}
        onLoadRecommendations={onLoadRecommendations}
        settings={settings}
        onQueueSelected={onQueueSelected}
        onWatchlistSelected={onWatchlistSelected}
        onFollowSelected={onFollowSelected}
        onPlayTrailer={onPlayTrailer}
        onOpenLink={onOpenLink}
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
