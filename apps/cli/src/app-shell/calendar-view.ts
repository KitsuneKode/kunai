// =============================================================================
// calendar-view.ts — pure view-model builder for calendar schedule UI
//
// Design authority: .design/cli/kunai-sakura-calendar-locked.html
// =============================================================================

import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";

import {
  CALENDAR_TYPE_TABS,
  type CalendarDay,
  type CalendarTypeTab,
  buildCalendarPreviewRailModel,
  buildCalendarDaysFromOptions,
  calendarDayKeyFromGroup,
  calendarReleaseRowPresentation,
  deriveCalendarReleaseState,
  filterCalendarOptionsByDay,
  filterCalendarOptionsByType,
  formatCalendarReleaseStateLabel,
  isCalendarTrackedOption,
  parsePreviewTimeTodayMs,
  windowCalendarDayStrip,
} from "./calendar-ui";
import type { PreviewPosterState, PreviewRailModel } from "./primitives/PreviewRail";

export type CalendarViewState = "loading" | "empty" | "success" | "error";

export type CalendarScheduleRow = {
  readonly optionIndex: number;
  readonly option: BrowseShellOption<SearchResult>;
  readonly timeLabel: string;
  readonly episodeCode: string;
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly statusDim: boolean;
  readonly statusGlyph: string;
  readonly showDayHeader: boolean;
  readonly dayHeaderLabel: string | null;
};

export type CalendarView = {
  readonly state: CalendarViewState;
  readonly typeTab: CalendarTypeTab;
  readonly typeTabLabels: readonly string[];
  readonly typeTabIndex: number;
  readonly days: readonly CalendarDay[];
  readonly selectedDayKey: string | null;
  readonly dayStripLabels: readonly string[];
  readonly rows: readonly CalendarScheduleRow[];
  readonly rail: PreviewRailModel | null;
  readonly showForYouHeader: boolean;
};

export function calendarTypeTabIndex(tab: CalendarTypeTab): number {
  return CALENDAR_TYPE_TABS.indexOf(tab);
}

export function calendarTypeTabFromIndex(index: number): CalendarTypeTab {
  return CALENDAR_TYPE_TABS[Math.max(0, Math.min(CALENDAR_TYPE_TABS.length - 1, index))] ?? "All";
}

export function calendarTypeTabLabels(): readonly string[] {
  return CALENDAR_TYPE_TABS.map((tab) => (tab === "TV" ? "Series" : tab));
}

function mediaTypeSortRank(option: BrowseShellOption<SearchResult>): number {
  const source = option.value.metadataSource?.toLowerCase() ?? "";
  if (source.includes("anilist")) return 0;
  if (option.value.type === "movie") return 2;
  return 1;
}

function sortTimestampMs(option: BrowseShellOption<SearchResult>, nowMs: number): number {
  const time = option.previewTime?.trim() ?? "";
  if (time.length > 0) {
    const parsed = parsePreviewTimeTodayMs(time, nowMs);
    if (parsed !== null) return parsed;
  }
  if (option.previewDayKey) {
    const base = Date.parse(`${option.previewDayKey}T12:00:00`);
    if (Number.isFinite(base)) return base;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function sortCalendarOptions(
  options: readonly BrowseShellOption<SearchResult>[],
  nowMs: number = Date.now(),
): readonly BrowseShellOption<SearchResult>[] {
  return [...options].sort((left, right) => {
    const timeDelta = sortTimestampMs(left, nowMs) - sortTimestampMs(right, nowMs);
    if (timeDelta !== 0) return timeDelta;
    const typeDelta = mediaTypeSortRank(left) - mediaTypeSortRank(right);
    if (typeDelta !== 0) return typeDelta;
    return left.label.localeCompare(right.label);
  });
}

export function buildCalendarDaysFromOptionsView<T>(
  options: readonly BrowseShellOption<T>[],
  narrow: boolean,
): readonly CalendarDay[] {
  return buildCalendarDaysFromOptions(options, narrow);
}

function episodeCode(option: BrowseShellOption<SearchResult>): string {
  const badge = option.previewBadge;
  if (badge && badge !== "wl") return badge.startsWith("E") ? badge : badge;
  const body = option.previewBody ?? option.detail ?? "";
  const match = body.match(/(?:S\d+E\d+|E\d+)/i);
  return match?.[0]?.toUpperCase() ?? "";
}

export function buildCalendarView(input: {
  readonly options: readonly BrowseShellOption<SearchResult>[];
  readonly typeTab: CalendarTypeTab;
  readonly selectedDayKey: string | null;
  readonly selectedIndex: number;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly narrow: boolean;
  readonly posterState: PreviewPosterState;
  readonly nowMs?: number;
}): CalendarView {
  const nowMs = input.nowMs ?? Date.now();
  const filtered = sortCalendarOptions(
    filterCalendarOptionsByDay(
      filterCalendarOptionsByType(input.options, input.typeTab),
      input.selectedDayKey,
    ),
    nowMs,
  );
  const days = buildCalendarDaysFromOptionsView(input.options, input.narrow);
  const { windowDays, hasPrev, hasNext } = windowCalendarDayStrip(
    days,
    input.selectedDayKey,
    input.narrow,
  );
  const dayStripLabels = [
    hasPrev ? "‹" : " ",
    ...windowDays.map((day) => day.label),
    hasNext ? "›" : " ",
  ];

  const showForYouHeader =
    input.selectedDayKey === null ||
    filtered.some(
      (option) =>
        isCalendarTrackedOption(option) ||
        deriveCalendarReleaseState(option, nowMs) === "countdown" ||
        deriveCalendarReleaseState(option, nowMs) === "available",
    );

  let lastDayHeader: string | null = null;
  const rows: CalendarScheduleRow[] = [];
  for (let index = input.windowStart; index < input.windowEnd; index += 1) {
    const option = filtered[index];
    if (!option) continue;
    const presentation = calendarReleaseRowPresentation(option, nowMs);
    const state = deriveCalendarReleaseState(option, nowMs);
    const timeLabel =
      state === "countdown"
        ? formatCalendarReleaseStateLabel(state, option, nowMs)
        : (option.previewTime?.trim() ?? "TBD");
    const dayHeaderLabel =
      input.selectedDayKey === null && option.previewGroup
        ? calendarDayKeyFromGroup(option.previewGroup)
        : null;
    const showDayHeader = dayHeaderLabel !== null && dayHeaderLabel !== lastDayHeader;
    if (showDayHeader) lastDayHeader = dayHeaderLabel;

    rows.push({
      optionIndex: index,
      option,
      timeLabel,
      episodeCode: episodeCode(option),
      statusLabel: presentation.label,
      statusColor: presentation.color,
      statusDim: presentation.dim,
      statusGlyph: presentation.glyph.trim(),
      showDayHeader,
      dayHeaderLabel: showDayHeader ? dayHeaderLabel : null,
    });
  }

  const selectedOption = filtered[input.selectedIndex];
  const rail = selectedOption
    ? buildCalendarPreviewRailModel(selectedOption, input.posterState, nowMs)
    : null;

  return {
    state: filtered.length > 0 ? "success" : "empty",
    typeTab: input.typeTab,
    typeTabLabels: calendarTypeTabLabels(),
    typeTabIndex: calendarTypeTabIndex(input.typeTab),
    days,
    selectedDayKey: input.selectedDayKey,
    dayStripLabels,
    rows,
    rail,
    showForYouHeader,
  };
}
