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
  isCalendarTrackedOption,
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
  const kind = option.value.calendar?.contentKind;
  if (kind === "anime") return 0;
  if (kind === "movie") return 2;
  return 1;
}

function sortTimestampMs(option: BrowseShellOption<SearchResult>, _nowMs: number): number {
  const releaseAt = option.value.calendar?.releaseAt;
  if (releaseAt) {
    const ms = Date.parse(releaseAt);
    if (Number.isFinite(ms)) return ms;
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
  const code = option.value.calendar?.display.episodeCode;
  if (code) return code;
  const badge = option.previewBadge;
  return badge && badge !== "wl" ? badge : "";
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
    // Left column is the real clock time; the countdown is shown in the status column.
    const timeLabel = option.calendar?.display.time ?? option.previewTime?.trim() ?? "TBD";
    const groupLabel = option.calendar?.display.groupLabel ?? option.previewGroup;
    const dayHeaderLabel =
      input.selectedDayKey === null && groupLabel ? calendarDayKeyFromGroup(groupLabel) : null;
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
