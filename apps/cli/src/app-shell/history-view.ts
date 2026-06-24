// =============================================================================
// history-view.ts — pure view-model builder for history / continue UI
//
// Design authority: .design/cli/surfaces/stats-history-library.md
// =============================================================================

import { reconcileContinueHistory } from "@/domain/continuation/history-reconciliation";
import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import { fuzzyMatch, rankFuzzyMatches } from "@/domain/session/fuzzy-match";
import {
  hasDualContinueSources,
  resumeLabelForProjection,
} from "@/services/continuation/continuation-source";
import {
  correctedHistoryMediaKind,
  historyContentType,
} from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@/services/storage/storage-read-models";

import {
  buildHistoryPickerOptions,
  groupHistoryByRecency,
  historyBucketFor,
  type HistoryPickerOptionsContext,
} from "./panel-data";
import type { PreviewPosterState, PreviewRailModel } from "./primitives/PreviewRail.model";
import { RETURN_LOOP_HISTORY_NEW_SECTION } from "./return-loop-copy";
import { describeHistoryReturnLoopDetail, formatNewSinceEpisodeLabel } from "./root-history-bridge";
import { getWindowStart } from "./shell-text";
import { palette, semanticToneColor } from "./shell-theme";
import type { ShellPickerOption, ShellStatusTone } from "./types";

const HISTORY_TABS = ["continue", "completed", "new-episodes", "all"] as const;
export type HistoryTab = (typeof HISTORY_TABS)[number];

// Second filter axis: content type. Uses correctedHistoryMediaKind so a drama
// watched in anime mode (legacy mislabel) filters as Series, not Anime (#1/#4).
const HISTORY_TYPE_FILTERS = ["all", "anime", "series", "movie"] as const;
export type HistoryTypeFilter = (typeof HISTORY_TYPE_FILTERS)[number];

export function historyTypeFilterLabels(): readonly string[] {
  return ["All", "Anime", "Series", "Movies"];
}

export function historyTypeFilterIndex(filter: HistoryTypeFilter): number {
  return Math.max(0, HISTORY_TYPE_FILTERS.indexOf(filter));
}

export function cycleHistoryTypeFilter(filter: HistoryTypeFilter): HistoryTypeFilter {
  return HISTORY_TYPE_FILTERS[
    (historyTypeFilterIndex(filter) + 1) % HISTORY_TYPE_FILTERS.length
  ] as HistoryTypeFilter;
}

function matchesHistoryTypeFilter(entry: HistoryProgress, filter: HistoryTypeFilter): boolean {
  return filter === "all" || correctedHistoryMediaKind(entry) === filter;
}

export type HistoryViewState = "loading" | "empty" | "success" | "error";

export type HistoryViewRow = {
  readonly titleId: string;
  readonly title: string;
  readonly episodeCode: string;
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly statusDim: boolean;
  readonly detail: string;
  readonly recencyLabel: string;
  readonly badge?: string;
  readonly tone?: ShellStatusTone;
  readonly progress: { readonly percentage: number; readonly completed: boolean } | null;
  readonly resumeAction: string;
  readonly dualSourceAvailable: boolean;
};

export type HistoryRenderItem =
  | { readonly kind: "section"; readonly label: string }
  | {
      readonly kind: "row";
      readonly row: HistoryViewRow;
      readonly flatIndex: number;
      readonly selected: boolean;
    };

export type HistoryView = {
  readonly state: HistoryViewState;
  /** Present only when `state === "error"`; the user-facing failure detail. */
  readonly errorMessage?: string;
  readonly tab: HistoryTab;
  readonly tabLabels: readonly string[];
  readonly tabIndex: number;
  readonly typeFilter: HistoryTypeFilter;
  readonly typeFilterLabels: readonly string[];
  readonly typeFilterIndex: number;
  readonly flatRows: readonly HistoryViewRow[];
  readonly items: readonly HistoryRenderItem[];
  readonly rail: PreviewRailModel | null;
  readonly filterQuery: string;
  readonly showScrollUp: boolean;
  readonly showScrollDown: boolean;
};

/** Common type-filter fields for every HistoryView return path. */
function historyTypeFilterView(typeFilter: HistoryTypeFilter): {
  readonly typeFilter: HistoryTypeFilter;
  readonly typeFilterLabels: readonly string[];
  readonly typeFilterIndex: number;
} {
  return {
    typeFilter,
    typeFilterLabels: historyTypeFilterLabels(),
    typeFilterIndex: historyTypeFilterIndex(typeFilter),
  };
}

function historyTabLabels(): readonly string[] {
  return ["Continue", "Completed", "New episodes", "All"];
}

function historyTabIndex(tab: HistoryTab): number {
  return HISTORY_TABS.indexOf(tab);
}

export function historyTabFromLegacy(mode: "all" | "watching" | "completed"): HistoryTab {
  if (mode === "watching") return "continue";
  if (mode === "completed") return "completed";
  return "all";
}

export function cycleHistoryTab(tab: HistoryTab): HistoryTab {
  const index = HISTORY_TABS.indexOf(tab);
  return HISTORY_TABS[(index + 1) % HISTORY_TABS.length] ?? "continue";
}

function isHistoryCompleted(entry: HistoryProgress): boolean {
  // The persisted completed flag (e.g. "mark as watched", or credits/EOF) is the
  // authority; the 95% ratio is only a fallback when a positive duration is known.
  if (entry.completed) return true;
  const duration = entry.durationSeconds ?? 0;
  return duration > 0 && entry.positionSeconds / duration >= 0.95;
}

function matchesHistoryTab(
  titleId: string,
  entry: HistoryProgress,
  tab: HistoryTab,
  context: HistoryPickerOptionsContext,
): boolean {
  if (tab === "all") return true;
  // Single honest authority (classifyHistoryBucket): in-progress → continue, a
  // freshly-aired episode → new-episodes, finished/caught-up → completed. No tab
  // overlaps and nothing leaks (the old reconcile fallback fabricated "new-episode"
  // for every finished title without release data, flooding New and emptying
  // Completed).
  const bucket = historyBucketFor(titleId, entry, context);
  return (
    (tab === "continue" && bucket === "continue") ||
    (tab === "completed" && bucket === "completed") ||
    (tab === "new-episodes" && bucket === "new-episodes")
  );
}

function filterHistoryEntries(
  historyEntries: ReadonlyArray<[string, HistoryProgress]>,
  filterQuery: string,
  tab: HistoryTab,
  context: HistoryPickerOptionsContext,
  typeFilter: HistoryTypeFilter = "all",
): readonly [string, HistoryProgress][] {
  const filter = filterQuery.trim().toLowerCase();
  const base = historyEntries.filter(([titleId, entry]) => {
    if (!matchesHistoryTypeFilter(entry, typeFilter)) return false;
    const bucket = historyBucketFor(titleId, entry, context);

    if (filter.length > 0) {
      if (filter === "completed" && bucket === "completed") return true;
      if ((filter === "watching" || filter === "continue") && bucket === "continue") return true;
      if ((filter === "new" || filter === "new-episodes") && bucket === "new-episodes") return true;
      if (
        !fuzzyMatch(
          filter,
          `${entry.title} ${entry.providerId ?? "unknown"} s${entry.season ?? 1}e${entry.episode ?? entry.absoluteEpisode ?? 1}`,
        )
      ) {
        return false;
      }
    }

    return matchesHistoryTab(titleId, entry, tab, context);
  });

  if (filter === "completed" || filter === "watching" || filter === "continue") {
    return base;
  }

  return rankFuzzyMatches(
    base,
    filter === "new" || filter === "new-episodes" ? "" : filterQuery,
    ([, entry]) => [
      { value: entry.title, weight: 0 },
      { value: entry.providerId ?? "unknown", weight: 8 },
      { value: `s${entry.season ?? 1}e${entry.episode ?? entry.absoluteEpisode ?? 1}`, weight: 4 },
    ],
  );
}

function deriveResumeAction(
  titleId: string,
  entry: HistoryProgress,
  context: HistoryPickerOptionsContext,
): string {
  if (historyContentType(entry) === "movie") {
    return isHistoryCompleted(entry) ? "Restart" : "Resume";
  }
  const decision = reconcileContinueHistory({
    titleId,
    entries: [[titleId, entry]],
    nextRelease: context.nextReleases?.get(titleId) ?? null,
    catalogBounds: context.catalogBounds?.get(titleId) ?? null,
  });
  if (decision.kind === "new-episode") {
    const bucket = historyBucketFor(titleId, entry, context);
    if (bucket === "continue" || bucket === "new-episodes") return "Play next";
  }
  const bucket = historyBucketFor(titleId, entry, context);
  return resumeLabelForProjection(context.projections?.get(titleId), bucket);
}

function shellOptionToHistoryRow(
  titleId: string,
  entry: HistoryProgress,
  option: ShellPickerOption<string>,
  context: HistoryPickerOptionsContext,
): HistoryViewRow {
  const labelParts = option.label.split("·").map((part) => part.trim());
  const title = labelParts[0] ?? option.label;
  const episodeCode =
    labelParts[1] ?? (historyContentType(entry) === "series" ? "series" : "movie");
  const detailParts = (option.detail ?? "").split("·").map((part) => part.trim());
  const recencyLabel = detailParts[detailParts.length - 1] ?? "";
  const progress = option.historyProgress ?? null;
  const projection = context.projections?.get(titleId);
  const bucket = historyBucketFor(titleId, entry, context);
  const decision = reconcileContinueHistory({
    titleId,
    entries: [[titleId, entry]],
    nextRelease: context.nextReleases?.get(titleId) ?? null,
    catalogBounds: context.catalogBounds?.get(titleId) ?? null,
  });
  const hasContinueNext =
    decision.kind === "new-episode" &&
    typeof decision.episode === "number" &&
    bucket === "continue";
  const statusLabel =
    projection?.badge ??
    option.badge ??
    (hasContinueNext
      ? "next"
      : progress?.completed
        ? "done"
        : progress
          ? `${progress.percentage}%`
          : (detailParts[0] ?? ""));
  const isNewEpisode = decision.kind === "new-episode" && bucket === "new-episodes";
  let statusColor = semanticToneColor(option.tone);
  if (isNewEpisode) statusColor = palette.ok;
  if (hasContinueNext) statusColor = palette.accentDeep;
  if (progress && !progress.completed && !hasContinueNext) statusColor = palette.accentDeep;

  return {
    titleId,
    title,
    episodeCode,
    statusLabel,
    statusColor,
    statusDim: option.tone !== "success" && option.tone !== "warning",
    detail: option.detail ?? "",
    recencyLabel,
    badge: option.badge,
    tone: option.tone,
    progress,
    resumeAction: deriveResumeAction(titleId, entry, context),
    dualSourceAvailable: hasDualContinueSources(projection),
  };
}

function optionsToFlatRows(
  options: readonly ShellPickerOption<string>[],
  entryById: ReadonlyMap<string, HistoryProgress>,
  context: HistoryPickerOptionsContext,
): HistoryViewRow[] {
  const rows: HistoryViewRow[] = [];
  for (const option of options) {
    if (typeof option.value === "string" && option.value.startsWith("section:")) continue;
    const entry = entryById.get(option.value);
    if (!entry) continue;
    rows.push(shellOptionToHistoryRow(option.value, entry, option, context));
  }
  return rows;
}

function buildHistorySections(
  flatRows: readonly HistoryViewRow[],
  filteredEntries: ReadonlyArray<[string, HistoryProgress]>,
  tab: HistoryTab,
): { label: string; rows: HistoryViewRow[] }[] {
  if (tab === "continue" && flatRows.length > 0) {
    return [{ label: "Continue watching", rows: [...flatRows] }];
  }
  if (tab === "new-episodes" && flatRows.length > 0) {
    return [{ label: RETURN_LOOP_HISTORY_NEW_SECTION, rows: [...flatRows] }];
  }

  const rowById = new Map(flatRows.map((row) => [row.titleId, row]));
  const groups = groupHistoryByRecency(filteredEntries);
  if (groups.length <= 1) {
    return flatRows.length > 0 ? [{ label: "", rows: [...flatRows] }] : [];
  }

  const sections: Array<{ label: string; rows: HistoryViewRow[] }> = [];
  for (const group of groups) {
    const rows: HistoryViewRow[] = [];
    for (const [titleId] of group.items) {
      const row = rowById.get(titleId);
      if (row) rows.push(row);
    }
    if (rows.length > 0) sections.push({ label: group.label, rows });
  }
  return sections;
}

function buildHistoryPreviewRailModel(
  row: HistoryViewRow,
  entry: HistoryProgress,
  titleId: string,
  context: HistoryPickerOptionsContext,
  posterState: PreviewPosterState = "none",
): PreviewRailModel {
  const decision = reconcileContinueHistory({
    titleId,
    entries: [[titleId, entry]],
    nextRelease: context.nextReleases?.get(titleId) ?? null,
    catalogBounds: context.catalogBounds?.get(titleId) ?? null,
  });
  const returnLoopDetail = describeHistoryReturnLoopDetail({
    entry,
    nextRelease: context.nextReleases?.get(titleId) ?? null,
  });
  const progress = projectWatchProgress({
    timestamp: entry.positionSeconds,
    duration: entry.durationSeconds,
    completed: entry.completed,
  });
  const watchedAt = new Date(entry.updatedAt).toLocaleDateString();
  const newSince =
    decision.kind === "new-episode" &&
    historyContentType(entry) === "series" &&
    typeof decision.episode === "number"
      ? formatNewSinceEpisodeLabel(entry.episode ?? entry.absoluteEpisode ?? 1, decision.episode)
      : null;

  const facts: PreviewRailModel["facts"][number][] = [
    {
      label: "Progress",
      value: row.progress
        ? `${row.progress.percentage}%`
        : progress.completed
          ? "Complete"
          : "Saved",
      tone: row.progress?.completed || progress.completed ? "success" : "warning",
    },
    { label: "Last watched", value: watchedAt },
    { label: "Provider", value: entry.providerId ?? "unknown", tone: "muted" },
  ];
  if (returnLoopDetail) {
    facts.push({ label: "Next", value: returnLoopDetail, tone: "success" });
  } else if (newSince) {
    facts.push({ label: "Next", value: newSince, tone: "success" });
  }

  return {
    title: row.title,
    subtitle: row.episodeCode,
    overview: row.detail,
    posterUrl: entry.posterUrl,
    posterState,
    facts,
  };
}

function buildVisibleItems(
  sections: readonly { label: string; rows: readonly HistoryViewRow[] }[],
  flatRows: readonly HistoryViewRow[],
  selectedIndex: number,
  windowStart: number,
  windowEnd: number,
): HistoryRenderItem[] {
  const visibleIds = new Set(flatRows.slice(windowStart, windowEnd).map((row) => row.titleId));
  const items: HistoryRenderItem[] = [];
  for (const section of sections) {
    const visibleRows = section.rows.filter((row) => visibleIds.has(row.titleId));
    if (visibleRows.length === 0) continue;
    if (section.label.trim().length > 0) {
      items.push({ kind: "section", label: section.label.toUpperCase() });
    }
    for (const row of visibleRows) {
      const flatIndex = flatRows.findIndex((candidate) => candidate.titleId === row.titleId);
      items.push({
        kind: "row",
        row,
        flatIndex,
        selected: flatIndex === selectedIndex,
      });
    }
  }
  return items;
}

export function buildHistoryView(input: {
  readonly entries: ReadonlyArray<[string, HistoryProgress]>;
  readonly tab: HistoryTab;
  readonly typeFilter?: HistoryTypeFilter;
  readonly filterQuery: string;
  readonly selectedIndex: number;
  readonly maxVisible: number;
  readonly narrow: boolean;
  readonly context: HistoryPickerOptionsContext;
  readonly loading?: boolean;
  readonly error?: string | null;
}): HistoryView {
  const typeFilter = input.typeFilter ?? "all";
  const typeFilterView = historyTypeFilterView(typeFilter);
  if (input.error && !input.loading) {
    return {
      state: "error",
      errorMessage: input.error,
      tab: input.tab,
      tabLabels: historyTabLabels(),
      tabIndex: historyTabIndex(input.tab),
      ...typeFilterView,
      flatRows: [],
      items: [],
      rail: null,
      filterQuery: input.filterQuery,
      showScrollUp: false,
      showScrollDown: false,
    };
  }
  if (input.loading) {
    return {
      state: "loading",
      tab: input.tab,
      tabLabels: historyTabLabels(),
      tabIndex: historyTabIndex(input.tab),
      ...typeFilterView,
      flatRows: [],
      items: [],
      rail: null,
      filterQuery: input.filterQuery,
      showScrollUp: false,
      showScrollDown: false,
    };
  }

  const filtered = filterHistoryEntries(
    input.entries,
    input.filterQuery,
    input.tab,
    input.context,
    typeFilter,
  );
  const options = buildHistoryPickerOptions(filtered, input.context);
  const entryById = new Map(filtered);
  const builtRows = optionsToFlatRows(options, entryById, input.context);

  if (builtRows.length === 0) {
    return {
      state: "empty",
      tab: input.tab,
      tabLabels: historyTabLabels(),
      tabIndex: historyTabIndex(input.tab),
      ...typeFilterView,
      flatRows: [],
      items: [],
      rail: null,
      filterQuery: input.filterQuery,
      showScrollUp: false,
      showScrollDown: false,
    };
  }

  // The section layout (recency groups, hoisted "Continue watching") is the single
  // source of truth for row order. `flatRows` — the basis for arrow-key navigation,
  // the `selected` highlight, the scroll window, and Enter selection — is flattened
  // from those same sections so the displayed order and the navigated order can never
  // disagree (otherwise the highlight juggles across rows as you move up/down).
  const sections = buildHistorySections(builtRows, filtered, input.tab);
  const flatRows = sections.flatMap((section) => section.rows);

  const safeSelectedIndex = Math.min(
    Math.max(input.selectedIndex, 0),
    Math.max(flatRows.length - 1, 0),
  );
  const windowStart = getWindowStart(safeSelectedIndex, flatRows.length, input.maxVisible);
  const windowEnd = Math.min(windowStart + input.maxVisible, flatRows.length);
  const selectedRow = flatRows[safeSelectedIndex];
  const selectedEntry = selectedRow ? entryById.get(selectedRow.titleId) : undefined;
  const rail =
    selectedRow && selectedEntry && !input.narrow
      ? buildHistoryPreviewRailModel(selectedRow, selectedEntry, selectedRow.titleId, input.context)
      : null;

  return {
    state: "success",
    tab: input.tab,
    tabLabels: historyTabLabels(),
    tabIndex: historyTabIndex(input.tab),
    ...typeFilterView,
    flatRows,
    items: buildVisibleItems(sections, flatRows, safeSelectedIndex, windowStart, windowEnd),
    rail,
    filterQuery: input.filterQuery,
    showScrollUp: windowStart > 0,
    showScrollDown: windowEnd < flatRows.length,
  };
}
