import { useLineEditor } from "@/app-shell/line-editor";
import { addSearchQuery, getSearchHistory } from "@/app-shell/search-history";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  applyBrowseResultFilters,
  describeBrowseResultFilters,
  hasBrowseResultFilters,
  parseBrowseFilterQuery,
} from "./browse-filters";
import { resolveIdleContinueAction } from "./browse-idle-actions";
import {
  filterBrowseOptionsByResultFilter,
  buildPreviewRailModelFromBrowseOption,
  mapPosterPreviewState,
} from "./browse-preview-rail";
import { isQueryDirty, normalizeBrowseCommandInput } from "./browse-search-state";
import {
  buildCalendarDaysFromOptions,
  buildCalendarRenderRows,
  CalendarDayStrip,
  CalendarScheduleRow,
  CalendarTypeTabs,
  CALENDAR_TYPE_TABS,
  filterCalendarOptionsByDay,
  filterCalendarOptionsByType,
  type CalendarTypeTab,
} from "./calendar-ui";
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
import { deleteAllKittyImages } from "./image-pane";
import { getBrowseCommandPaletteMaxVisible } from "./layout-policy";
import type { BrowseOverlay } from "./overlay-panel";
import { OverlayPanel } from "./overlay-panel";
import { PreviewRail, shouldRenderPreviewRail } from "./primitives/PreviewRail";
import { mountRootContent } from "./root-content-state";
import {
  CommandPalette,
  getCommandAutocompleteTarget,
  getCommandMatches,
  getHighlightedCommand,
} from "./shell-command-ui";
import { getCommandLabel, InputField } from "./shell-frame";
import { ContextStrip, ResizeBlocker, ShellFooter, selectFooterActions } from "./shell-primitives";
import { getWindowStart, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
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

function clearShellScreen() {
  if (process.stdout.isTTY) {
    deleteAllKittyImages();
  }
}

export function BrowseShell<T>({
  provider,
  initialQuery,
  initialResults,
  initialResultSubtitle,
  initialSelectedIndex,
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
  onResolve: (action: ShellAction) => void;
  onSubmit: (value: T) => void;
  onCancel: () => void;
  idleContext?: import("./types").BrowseIdleContext;
}) {
  const viewport = useDebouncedViewportPolicy("browse", {
    forceCompact: _settings?.minimalMode,
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
  const [_selectedDetail, setSelectedDetail] = useState(
    initialResults?.[initialSelectedIndex ?? 0]?.detail ??
      "Search for a title — or try /trending to see what's popular",
  );
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
  const [emptyMessage, setEmptyMessage] = useState(
    "Search for a title — or try /trending to see what's popular",
  );
  const [activeFilterBadges, setActiveFilterBadges] = useState<readonly string[]>([]);
  const [resultFilter, setResultFilter] = useState("");
  const [resultFilterFocused, setResultFilterFocused] = useState(false);
  // Calendar filters — null day means "show all days"
  const [calendarDayFilter, setCalendarDayFilter] = useState<string | null>(null);
  const [calendarTypeTab, setCalendarTypeTab] = useState<CalendarTypeTab>("All");
  // In zen/minimal mode, auto-focus the continue-watching row if there's a resumable title and no initial results
  const [idleFocused, setIdleFocused] = useState(
    () =>
      !!(
        _settings?.minimalMode &&
        idleContext?.continueWatching?.titleId &&
        (!initialResults || initialResults.length === 0)
      ),
  );
  const requestIdRef = useRef(0);
  const [companionDetails, setCompanionDetails] = useState<DetailsPanelData>(() =>
    buildDetailsPanelDataFromBrowseOption(initialResults?.[initialSelectedIndex ?? 0]),
  );

  // Calendar view detection and day-strip derived state.
  // displayGroup is only set by calendar-results.ts, so any option with previewGroup
  // indicates calendar mode. Fall back to subtitle check for edge cases.
  const isCalendarView =
    options.some((opt) => opt.previewGroup !== undefined) || resultSubtitle.includes("schedule");

  const calendarDays = useMemo(() => {
    if (!isCalendarView) return [];
    return buildCalendarDaysFromOptions(options, viewport.breakpoint === "narrow");
  }, [isCalendarView, options, viewport.breakpoint]);

  const displayOptions = useMemo(() => {
    const narrowed = filterBrowseOptionsByResultFilter(options, resultFilter);
    if (!isCalendarView) return narrowed;
    const scheduleOptions = narrowed as readonly BrowseShellOption<
      import("@/domain/types").SearchResult
    >[];
    const typed = filterCalendarOptionsByType(scheduleOptions, calendarTypeTab);
    return filterCalendarOptionsByDay(typed, calendarDayFilter) as typeof options;
  }, [calendarDayFilter, calendarTypeTab, isCalendarView, options, resultFilter]);

  const clearResults = useCallback(() => {
    setOptions([]);
    setSelectedIndex(0);
    setSearchState("idle");
    setLastSearchedQuery("");
    setErrorMessage(null);
    setEmptyMessage("Search for a title — or try /trending to see what's popular");
    setResultSubtitle("");
    setSelectedDetail("Search for a title — or try /trending to see what's popular");
    setActiveFilterBadges([]);
    setResultFilter("");
    setResultFilterFocused(false);
    setCalendarDayFilter(null);
    setCalendarTypeTab("All");
    setIdleFocused(false);
  }, []);

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
    setIdleFocused(false);
    setErrorMessage(null);
    setEmptyMessage("Searching…");
    setSelectedDetail("Finding titles and available matches…");
    setCalendarDayFilter(null);

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
      setResultFilterFocused(false);
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
      setSelectedDetail(
        filteredOptions[0]?.detail ?? "Use ↑↓ to move through results, then press Enter.",
      );
    } catch (error) {
      if (requestIdRef.current !== requestId) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(String(error));
      setEmptyMessage("Search failed.");
      setSelectedDetail("The search failed. Press Enter to retry or Esc to clear.");
    }
  }, [query, searchState, onSearch]);

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
    setSelectedDetail("Loading cached trending titles…");
    setCalendarDayFilter(null);

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
      setSelectedDetail(response.options[0]?.detail ?? "Use ↑↓ to move through trending titles.");
    } catch (error) {
      if (requestIdRef.current !== requestId) return;

      setSearchState("error");
      setOptions([]);
      setSelectedIndex(0);
      setErrorMessage(String(error));
      setEmptyMessage("Trending failed.");
      setSelectedDetail("Trending failed. Use search or press Ctrl+T to retry.");
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
    setSelectedDetail("Building personalized recommendations from history and TMDB…");
    setCalendarDayFilter(null);

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
      setSelectedDetail(
        response.options[0]?.detail ?? "Use ↑↓ to move through recommendation picks.",
      );

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
            setSelectedDetail(
              nextResponse.options[0]?.detail ?? "Use ↑↓ to move through recommendation picks.",
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
      setErrorMessage(String(error));
      setEmptyMessage("Recommendations failed.");
      setSelectedDetail("Recommendation loading failed. Try /recommendation again.");
    }
  };

  const closeOverlay = () => {
    setActiveOverlay(null);
  };

  const openDetailsOverlay = () => {
    const panel = buildBrowseDetailsPanel(selectedOption);
    const sheetLines = buildDetailsSheetLines(selectedOption, companionDetails.secondary);
    setCommandMode(false);
    setResultFilterFocused(false);
    setActiveOverlay({
      type: "details",
      title: panel.title,
      subtitle: panel.subtitle,
      lines: sheetLines.length > 0 ? sheetLines : panel.lines,
      imageUrl: panel.imageUrl,
      loading: false,
      scrollIndex: 0,
    });
  };

  const handleLocalAction = (action: ShellAction): boolean => {
    if (action === "details") {
      openDetailsOverlay();
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

  useEffect(() => {
    if (displayOptions.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, displayOptions.length - 1));
  }, [displayOptions.length]);

  useEffect(() => {
    const option = displayOptions[selectedIndex];
    if (!option) {
      return;
    }
    setSelectedDetail(option.detail ?? "Press Enter to select this result.");
  }, [displayOptions, selectedIndex]);

  useEffect(() => {
    if (!commandMode) {
      setHighlightedCommandIndex(0);
      return;
    }

    const matches = getCommandMatches(commandInput, commands);
    setHighlightedCommandIndex((current) => {
      if (matches.length === 0) return 0;
      return Math.min(current, matches.length - 1);
    });
  }, [commandInput, commandMode, commands]);

  const queryDirty = isQueryDirty({
    queryDraft: query,
    submittedQuery: lastSearchedQuery,
    resultFilter,
    focusedRegion: resultFilterFocused ? "result-filter" : "query",
    selectedIndex,
    detailsOpen: activeOverlay?.type === "details",
    detailsScroll:
      activeOverlay && "scrollIndex" in activeOverlay ? (activeOverlay.scrollIndex ?? 0) : 0,
  });
  const selectedOption = displayOptions[selectedIndex];

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

  const { compact, ultraCompact, minColumns, minRows, maxVisibleRows: maxVisible } = viewport;
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
  const windowStart = getWindowStart(selectedIndex, displayOptions.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, displayOptions.length);
  const visibleOptions = displayOptions.slice(windowStart, windowEnd);
  // The "Series"/"Movie" type is a quiet column only when the result set is
  // actually mixed; an all-series list never repeats "Series" on every row.
  const resultsAreMixed =
    !isCalendarView &&
    displayOptions.some((option) => option.previewMeta?.[0] === "Series") &&
    displayOptions.some((option) => option.previewMeta?.[0] === "Movie");
  const showCompanion = showCompanionLayout && !compact && Boolean(selectedOption);
  const { poster, posterState: posterPreviewState } = usePosterPreview(
    selectedOption?.previewImageUrl ?? undefined,
    {
      rows: 6,
      cols: 16,
      enabled: Boolean(selectedOption?.previewImageUrl),
      debounceMs: 90,
      variant: "detail",
    },
  );
  const previewRailModel = buildPreviewRailModelFromBrowseOption(
    selectedOption,
    mapPosterPreviewState({
      hasPosterPath: Boolean(selectedOption?.previewImageUrl),
      poster,
      posterState: posterPreviewState,
    }),
  );
  const showPreviewRail =
    showCompanion &&
    shouldRenderPreviewRail({ columns: viewport.columns, hasModel: previewRailModel !== null });

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
        setResultFilterFocused(true);
        setCommandMode(false);
      }
      return;
    }

    if (key.return && key.shift && selectedOption && searchState === "ready") {
      openDetailsOverlay();
      return;
    }

    if ((input === "t" && key.ctrl) || input === "\x14") {
      void loadDiscovery();
      return;
    }

    if ((input === "d" && key.ctrl) || input === "\x04") {
      if (selectedOption && displayOptions.length > 0 && !queryDirty && searchState === "ready") {
        onResolve("download");
      }
      return;
    }

    if (input.toLowerCase() === "q") {
      if (
        selectedOption &&
        onQueueSelected &&
        displayOptions.length > 0 &&
        !queryDirty &&
        searchState === "ready"
      ) {
        void Promise.resolve(onQueueSelected(selectedOption.value)).then(() => {
          setSelectedDetail(`Queued ${selectedOption.label}`);
          return undefined;
        });
      }
      return;
    }

    const canFocusContinue =
      options.length === 0 && searchState === "idle" && !!idleContext?.continueWatching?.titleId;

    if (key.tab) {
      onResolve("toggle-mode");
      return;
    }

    // Calendar day strip navigation — left/right arrows when in calendar mode
    if (isCalendarView && calendarDays.length > 0 && key.leftArrow) {
      setCalendarDayFilter((current) => {
        if (current === null) return calendarDays[calendarDays.length - 1]?.key ?? null;
        const idx = calendarDays.findIndex((d) => d.key === current);
        return idx > 0 ? (calendarDays[idx - 1]?.key ?? current) : current;
      });
      setSelectedIndex(0);
      return;
    }
    if (isCalendarView && calendarDays.length > 0 && key.rightArrow) {
      setCalendarDayFilter((current) => {
        if (current === null) return calendarDays[0]?.key ?? null;
        const idx = calendarDays.findIndex((d) => d.key === current);
        return idx < calendarDays.length - 1 ? (calendarDays[idx + 1]?.key ?? current) : current;
      });
      setSelectedIndex(0);
      return;
    }

    if (isCalendarView && !commandMode) {
      const tabIndex = Number(input) - 1;
      if (tabIndex >= 0 && tabIndex < CALENDAR_TYPE_TABS.length) {
        setCalendarTypeTab(CALENDAR_TYPE_TABS[tabIndex] ?? "All");
        setSelectedIndex(0);
        return;
      }
    }

    if (key.escape) {
      if (idleFocused) {
        setIdleFocused(false);
        return;
      }
      // In calendar view: escape clears day filter before clearing all results
      if (isCalendarView && calendarDayFilter !== null) {
        setCalendarDayFilter(null);
        setSelectedIndex(0);
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

    if (key.return && idleFocused && canFocusContinue) {
      onResolve(resolveIdleContinueAction(idleContext));
      return;
    }

    if (key.upArrow && idleFocused) {
      setIdleFocused(false);
      return;
    }

    if (key.upArrow && displayOptions.length > 0) {
      setSelectedIndex((current) => (current - 1 + displayOptions.length) % displayOptions.length);
      return;
    }

    if (key.downArrow && displayOptions.length > 0) {
      setSelectedIndex((current) => (current + 1) % displayOptions.length);
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
      if (canFocusContinue && historyIndex === -1) {
        setIdleFocused(true);
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
      setIdleFocused(false);
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
          ) : searchState === "ready" && displayOptions.length > 0 ? (
            <Text color={palette.muted}>{displayOptions.length} results</Text>
          ) : null}
        </Box>
        {!ultraCompact && resultSubtitle ? (
          <Text color={palette.muted}>{resultSubtitle}</Text>
        ) : null}
        {searchState === "ready" && options.length > 0 && !isCalendarView && !ultraCompact ? (
          <InputField
            label="Filter results"
            value={resultFilter}
            onChange={(next) => {
              setResultFilter(next);
              setSelectedIndex(0);
            }}
            onSubmit={() => setResultFilterFocused(false)}
            placeholder="narrows current results only"
            focus={resultFilterFocused && !commandMode}
            maxWidth={innerWidth}
            onRedraw={clearShellScreen}
          />
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
              {"  ·  ← → browse days  ·  1–4 filter type  ·  / commands"}
            </Text>
          </Box>
        ) : (
          <InputField
            label="Search title"
            value={query}
            onChange={updateQuery}
            onSubmit={handleQuerySubmit}
            placeholder={placeholder}
            focus={!commandMode && !resultFilterFocused}
            hint={
              commandMode
                ? undefined
                : "Tokens: type:series year:2008 rating:8 · /filters for guided chips"
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

        {searchState === "error" && errorMessage ? (
          <Box marginTop={1} flexDirection="column" flexGrow={1}>
            <Text color={palette.danger}>{errorMessage}</Text>
            <Text color={palette.muted} dimColor>
              Press Enter to retry or Esc to clear
            </Text>
          </Box>
        ) : null}

        {isCalendarView && calendarDays.length > 0 && !ultraCompact ? (
          <Box flexDirection="column">
            <CalendarDayStrip days={calendarDays} selectedDayKey={calendarDayFilter} />
            <CalendarTypeTabs activeTab={calendarTypeTab} compact={compact} />
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
              {windowStart > 0 ? <Text color={palette.dim}> ▲ ...</Text> : null}
              {isCalendarView
                ? buildCalendarRenderRows(
                    displayOptions as readonly BrowseShellOption<
                      import("@/domain/types").SearchResult
                    >[],
                    windowStart,
                    windowEnd,
                  ).map((row) => (
                    <CalendarScheduleRow
                      key={`${row.option.label}-${row.optionIndex}-${row.timeLabel}`}
                      option={row.option}
                      selected={row.optionIndex === selectedIndex}
                      rowWidth={rowWidth}
                      showTimeHeader={row.showTimeHeader}
                      showTbdHeader={row.showTbdHeader}
                      timeLabel={row.timeLabel}
                    />
                  ))
                : visibleOptions.map((option, index) => {
                    const optionIndex = windowStart + index;
                    const selected = optionIndex === selectedIndex;
                    const metaText =
                      option.previewBadge ??
                      (resultsAreMixed ? option.previewMeta?.[0] : undefined);
                    const metaWidth = metaText ? Math.min(12, Math.max(6, metaText.length)) : 0;
                    const titleBudget = Math.max(12, rowWidth - metaWidth - 6);
                    const titleText = truncateLine(option.label, titleBudget);
                    const metaSegment = metaText ? truncateLine(metaText, metaWidth) : "";
                    const rowText = metaText
                      ? `${titleText.padEnd(titleBudget)} ${metaSegment.padStart(metaWidth)}`
                      : titleText;

                    return (
                      <Box
                        key={`${option.label}-${option.detail ?? ""}`}
                        flexDirection="column"
                        width={rowWidth}
                      >
                        <Box width={rowWidth}>
                          <Text bold={selected} dimColor={!selected} wrap="truncate">
                            <Text color={selected ? palette.accent : palette.dim}>
                              {selected ? "▌ " : "  "}
                            </Text>
                            <Text color={selected ? palette.text : palette.textDim}>
                              {truncateLine(rowText, rowWidth - 2).padEnd(rowWidth - 2)}
                            </Text>
                          </Text>
                        </Box>
                      </Box>
                    );
                  })}
              {windowEnd < displayOptions.length ? <Text color={palette.dim}> ▼ ...</Text> : null}
            </Box>

            {/* Companion pane */}
            {showCompanion ? (
              <Box
                key={`browse-companion-${selectedIndex}-${selectedOption?.label ?? "none"}`}
                marginLeft={2}
                flexDirection="column"
                width={previewWidth}
              >
                {showPreviewRail && previewRailModel ? (
                  <PreviewRail model={previewRailModel} width={previewWidth} />
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
            idleContext &&
            (!viewport.ultraCompact || !!idleContext.continueWatching?.titleId) ? (
              <Box flexDirection="column" marginTop={1} gap={0}>
                {idleContext.continueWatching && !idleContext.playlistNext ? (
                  <Text color={idleFocused ? palette.text : palette.muted}>
                    {idleFocused ? <Text color={palette.accent}>{"▌ "}</Text> : "  "}
                    {"⏸ "}
                    <Text color={palette.text} bold={idleFocused}>
                      {idleContext.continueWatching.title}
                    </Text>
                    {idleContext.continueWatching.ep ? (
                      <Text color={idleFocused ? palette.accent : palette.muted}>
                        {`  ${idleContext.continueWatching.ep}`}
                      </Text>
                    ) : null}
                    {idleContext.continueWatching.remainingLabel ? (
                      <Text color={palette.dim}>
                        {`  · ${idleContext.continueWatching.remainingLabel}`}
                      </Text>
                    ) : null}
                    {idleFocused ? (
                      <Text color={palette.accent}>{" · ↵ resume"}</Text>
                    ) : idleContext.continueWatching.titleId ? (
                      <Text color={palette.dim}>{" · ↓ to select"}</Text>
                    ) : (
                      <Text color={palette.dim}>{" · continue watching"}</Text>
                    )}
                  </Text>
                ) : null}
                {idleContext.playlistNext ? (
                  <Text color={palette.accent}>
                    {"▶  "}
                    <Text color={palette.text}>{idleContext.playlistNext.title}</Text>
                    {idleContext.playlistNext.ep ? (
                      <Text color={palette.muted}>{`  ${idleContext.playlistNext.ep}`}</Text>
                    ) : null}
                    <Text color={palette.dim}>{" · up next in playlist"}</Text>
                  </Text>
                ) : null}
                {idleContext.todayReleaseCount && idleContext.todayReleaseCount > 0 ? (
                  <Text color={palette.accentDeep}>
                    {`${idleContext.todayReleaseCount} new episode${idleContext.todayReleaseCount === 1 ? "" : "s"} releasing today`}
                    <Text color={palette.dim}>{" · /notifications to see"}</Text>
                  </Text>
                ) : null}
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
            label: options.length > 0 && !queryDirty ? "open" : "search",
            action: "search",
            primary: true,
          },
          { key: "↑↓", label: "navigate", action: "search" },
          ...(options.length > 0 && !queryDirty && searchState === "ready"
            ? [
                { key: "shift+↵", label: "details", action: "details" as const },
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
            ? [{ key: "q", label: "queue", action: "playlist" as const }]
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
  idleContext,
}: {
  mode: "series" | "anime";
  provider: string;
  initialQuery?: string;
  initialResults?: readonly BrowseShellOption<T>[];
  initialResultSubtitle?: string;
  initialSelectedIndex?: number;
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
