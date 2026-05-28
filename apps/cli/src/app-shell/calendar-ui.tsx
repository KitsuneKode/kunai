import type { PreviewPosterState, PreviewRailModel } from "@/app-shell/primitives/PreviewRail";
import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import { Box, Text } from "ink";
import React from "react";

import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import {
  ListRow,
  listRowEpColumn,
  listRowStatusColumn,
  listRowTimeColumn,
  listRowTitleColumn,
} from "./primitives/ListRow";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock, type StateBlockModel } from "./primitives/StateBlock";
import { RETURN_LOOP_CALENDAR_EMPTY_TAIL } from "./return-loop-copy";
import { palette } from "./shell-theme";

export type CalendarDay = {
  readonly key: string;
  readonly label: string;
  readonly isToday: boolean;
};

export type CalendarTypeTab = "All" | "Anime" | "TV" | "Movies" | "Tracked";

export const CALENDAR_TYPE_TABS: readonly CalendarTypeTab[] = [
  "All",
  "Anime",
  "TV",
  "Movies",
  "Tracked",
] as const;

/** Broadcast / schedule state — not the same as provider playability. */
export type CalendarReleaseState =
  | "available"
  | "countdown"
  | "resolving"
  | "missed"
  | "upcoming"
  | "failed";

export type CalendarPriorityBand = "for-you" | "also-today" | "later";

export function isCalendarBrowseOption<T>(option: BrowseShellOption<T> | undefined): boolean {
  return Boolean(option?.previewGroup);
}

export function isCalendarTrackedOption<T>(option: BrowseShellOption<T>): boolean {
  return option.previewBadge === "wl";
}

export function calendarPriorityBand<T>(option: BrowseShellOption<T>): CalendarPriorityBand {
  if (isCalendarTrackedOption(option)) return "for-you";
  const state = deriveCalendarReleaseState(option);
  if (state === "upcoming") return "later";
  return "also-today";
}

export function calendarPriorityBandLabel(band: CalendarPriorityBand): string {
  if (band === "for-you") return "For you";
  if (band === "later") return "Later";
  return "Also today";
}

export function buildCalendarDaysFromOptions<T>(
  options: readonly BrowseShellOption<T>[],
  _narrow?: boolean,
): readonly CalendarDay[] {
  const seen = new Set<string>();
  const days: CalendarDay[] = [];
  for (const option of options) {
    const group = option.previewGroup;
    if (!group) continue;
    const key = option.previewDayKey ?? calendarDayKeyFromGroup(group);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const isToday = group.includes("Today");
    const label = calendarDayKeyFromGroup(group);
    days.push({ key, label, isToday });
  }
  return days;
}

export function windowCalendarDayStrip(
  days: readonly CalendarDay[],
  selectedDayKey: string | null,
  narrow: boolean,
): {
  readonly windowDays: readonly CalendarDay[];
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
} {
  const visible = narrow ? 3 : 4;
  const activeIndex = Math.max(
    0,
    days.findIndex((day) => (selectedDayKey ? day.key === selectedDayKey : day.isToday)),
  );
  const start = Math.min(
    Math.max(0, activeIndex - Math.floor(visible / 2)),
    Math.max(0, days.length - visible),
  );
  return {
    windowDays: days.slice(start, start + visible),
    hasPrev: start > 0,
    hasNext: start + visible < days.length,
  };
}

export function calendarDayKeyFromGroup(group: string): string {
  const separatorIdx = group.indexOf(" · ");
  return separatorIdx >= 0 ? group.slice(0, separatorIdx) : group;
}

export function filterCalendarOptionsByDay<T>(
  options: readonly BrowseShellOption<T>[],
  dayKey: string | null,
): readonly BrowseShellOption<T>[] {
  if (dayKey === null) return options;
  return options.filter((option) => {
    if (!option.previewGroup && !option.previewDayKey) return false;
    const key = option.previewDayKey ?? calendarDayKeyFromGroup(option.previewGroup ?? "");
    return key === dayKey;
  });
}

export function filterCalendarOptionsByType(
  options: readonly BrowseShellOption<SearchResult>[],
  tab: CalendarTypeTab,
): readonly BrowseShellOption<SearchResult>[] {
  if (tab === "All") return options;
  if (tab === "Tracked") return options.filter((option) => isCalendarTrackedOption(option));
  return options.filter((option) => matchesCalendarType(option.value, tab));
}

function matchesCalendarType(result: SearchResult, tab: CalendarTypeTab): boolean {
  const source = result.metadataSource?.toLowerCase() ?? "";
  if (tab === "Movies") return result.type === "movie";
  if (tab === "Anime") return source.includes("anilist");
  if (tab === "TV") return result.type === "series" && source.includes("tmdb");
  return true;
}

export function parsePreviewTimeTodayMs(timeLabel: string, nowMs: number): number | null {
  const trimmed = timeLabel.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (minutes > 59) return null;
  if (meridiem && (hours < 1 || hours > 12)) return null;
  if (!meridiem && hours > 23) return null;
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  const date = new Date(nowMs);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

export function formatReleaseCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return "soon";
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  if (totalMinutes < 60) return `in ${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `in ${hours}h`;
  return `in ${hours}h ${minutes}m`;
}

export function deriveCalendarReleaseState<T>(
  option: BrowseShellOption<T>,
  nowMs: number = Date.now(),
): CalendarReleaseState {
  if (hasProviderConfirmedAvailability(option)) return "available";

  const metadata = option.value && typeof option.value === "object" ? option.value : null;
  const metadataSource =
    metadata && "metadataSource" in metadata && typeof metadata.metadataSource === "string"
      ? metadata.metadataSource.toLowerCase()
      : "";
  if (metadataSource.includes("failed") || metadataSource.includes("error")) {
    return "failed";
  }

  const releaseStatus = option.releaseStatus;
  if (releaseStatus === "upcoming") return "upcoming";
  if (releaseStatus === "airing-today") {
    const targetMs = parsePreviewTimeTodayMs(option.previewTime ?? "", nowMs);
    if (targetMs !== null && targetMs > nowMs) return "countdown";
    return "resolving";
  }
  if (releaseStatus === "released") {
    // Catalog "released" means the air date passed, not provider-confirmed playable.
    return isCalendarGroupToday(option.previewGroup) ? "resolving" : "missed";
  }
  return "upcoming";
}

export function hasProviderConfirmedAvailability<T>(option: BrowseShellOption<T>): boolean {
  const metadata = option.value && typeof option.value === "object" ? option.value : null;
  const release =
    metadata && "release" in metadata && typeof metadata.release === "object"
      ? metadata.release
      : null;
  if (
    release &&
    "status" in release &&
    release.status === "released" &&
    "providerConfirmed" in release &&
    release.providerConfirmed === true
  ) {
    return true;
  }

  const text = [
    ...(option.previewMeta ?? []),
    option.previewBadge,
    ...(option.previewFacts ?? []).flatMap((fact) => [fact.label, fact.detail]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return text.includes("provider confirmed") || text.includes("provider-confirmed");
}

function isCalendarGroupToday(group: string | undefined): boolean {
  return group?.toLowerCase().includes("today") ?? false;
}

export function formatCalendarReleaseStateLabel<T>(
  state: CalendarReleaseState,
  option: BrowseShellOption<T>,
  nowMs: number = Date.now(),
): string {
  if (state === "available") return "available now";
  if (state === "countdown") {
    const targetMs = parsePreviewTimeTodayMs(option.previewTime ?? "", nowMs);
    if (targetMs === null) return "airs today";
    return formatReleaseCountdown(targetMs - nowMs);
  }
  if (state === "resolving") return "aired · resolving";
  if (state === "missed") return "aired · not available";
  if (state === "failed") return "schedule unavailable";
  const dayKey = option.previewGroup ? calendarDayKeyFromGroup(option.previewGroup) : "";
  if (dayKey.length > 0) return dayKey;
  return "upcoming";
}

export function calendarReleaseRowPresentation<T>(
  option: BrowseShellOption<T>,
  nowMs: number = Date.now(),
): {
  readonly glyph: string;
  readonly color: string;
  readonly dim: boolean;
  readonly label: string;
} {
  const state = deriveCalendarReleaseState(option, nowMs);
  const label = formatCalendarReleaseStateLabel(state, option, nowMs);
  if (state === "available") {
    return { glyph: "✓ ", color: palette.ok, dim: false, label };
  }
  if (state === "countdown") {
    return { glyph: "◷ ", color: palette.accent, dim: false, label };
  }
  if (state === "resolving") {
    return { glyph: "◐ ", color: palette.dim, dim: true, label };
  }
  if (state === "missed") {
    return { glyph: "· ", color: palette.dangerDim, dim: true, label };
  }
  if (state === "failed") {
    return { glyph: "× ", color: palette.danger, dim: false, label };
  }
  return { glyph: "· ", color: palette.muted, dim: true, label };
}

export function buildCalendarPreviewRailModel(
  option: BrowseShellOption<SearchResult> | undefined,
  posterState: PreviewPosterState,
  nowMs: number = Date.now(),
): PreviewRailModel | null {
  if (!option) return null;
  const state = deriveCalendarReleaseState(option, nowMs);
  const stateLabel = formatCalendarReleaseStateLabel(state, option, nowMs);
  const stateTone =
    state === "available"
      ? ("success" as const)
      : state === "countdown"
        ? ("warning" as const)
        : state === "failed"
          ? ("danger" as const)
          : ("muted" as const);
  const tracked = isCalendarTrackedOption(option);
  const actionLabel =
    state === "available"
      ? "Enter to open"
      : state === "countdown" || state === "resolving" || state === "missed"
        ? "Enter for details · playback when a source resolves"
        : "Enter for details";

  const normalizedFacts: PreviewRailModel["facts"] = [
    { label: "Schedule", value: stateLabel, tone: stateTone },
    ...(tracked ? [{ label: "Tracked", value: "on your list", tone: "success" as const }] : []),
    ...(option.previewTime
      ? [{ label: "Airs", value: option.previewTime, tone: "muted" as const }]
      : []),
    {
      label: "Episode",
      value: option.previewBody ?? option.detail ?? "No schedule details",
      tone: "muted" as const,
    },
    { label: "Action", value: actionLabel, tone: "muted" as const },
  ].slice(0, 4);

  return {
    title: option.previewTitle ?? option.label,
    subtitle: [option.previewMeta?.[0], option.previewMeta?.[1]].filter(Boolean).join(" · "),
    overview:
      state === "resolving" || state === "missed"
        ? "This episode has aired on the schedule. Kunai will not offer playback until a provider source is available."
        : option.previewBody,
    posterUrl: option.previewImageUrl,
    posterState,
    facts: normalizedFacts,
  };
}

export function buildCalendarLoadingState(): StateBlockModel {
  return {
    kind: "loading",
    title: "Loading release schedule",
    detail:
      "Fetching this week's airing window from catalog metadata. Provider checks happen only when you open a release.",
  };
}

export function buildCalendarEmptyState(modeLabel: string): StateBlockModel {
  return {
    kind: "empty",
    title: "Nothing on the schedule",
    detail: `No ${modeLabel} releases matched this day and filter. Try another day or open /discover. ${RETURN_LOOP_CALENDAR_EMPTY_TAIL}`,
  };
}

export function buildCalendarErrorState(message: string): StateBlockModel {
  return {
    kind: "error",
    title: "Schedule unavailable",
    detail: message,
    actions: [
      {
        id: "retry-calendar",
        label: "Refresh schedule",
        detail: "Retry catalog metadata without touching providers",
        shortcut: "r",
        tone: "warning",
      },
    ],
  };
}

export function CalendarScheduleStatus({
  model,
  width = 72,
}: {
  readonly model: StateBlockModel;
  readonly width?: number;
}) {
  return (
    <Box marginTop={1}>
      <StateBlock model={model} width={width} />
    </Box>
  );
}

export function CalendarDayStrip({
  days,
  selectedDayKey,
  narrow = false,
}: {
  days: readonly CalendarDay[];
  selectedDayKey: string | null;
  narrow?: boolean;
}) {
  const { windowDays, hasPrev, hasNext } = windowCalendarDayStrip(days, selectedDayKey, narrow);

  return (
    <Box flexDirection="row" marginTop={1} marginBottom={1} alignItems="center">
      <Text color={palette.dim} dimColor>
        {hasPrev ? "‹ " : "  "}
      </Text>
      {windowDays.map((day) => {
        const isSelected = selectedDayKey === day.key;
        const isToday = day.isToday;
        return (
          <Box key={day.key} marginRight={2}>
            <Text
              color={isSelected || isToday ? palette.accent : palette.muted}
              bold={isSelected || isToday}
            >
              {day.label}
            </Text>
          </Box>
        );
      })}
      <Text color={palette.dim} dimColor>
        {hasNext ? " ›" : "  "}
      </Text>
      <Box marginLeft={1}>
        <Text color={palette.dim} dimColor>
          {selectedDayKey !== null ? "esc · all days" : "← → day"}
        </Text>
      </Box>
    </Box>
  );
}

export function CalendarTypeTabs({
  activeTab,
  compact,
}: {
  activeTab: CalendarTypeTab;
  compact: boolean;
}) {
  if (compact) return null;
  const labels = CALENDAR_TYPE_TABS.map((tab) => (tab === "TV" ? "Series" : tab));
  const activeIndex = CALENDAR_TYPE_TABS.indexOf(activeTab);
  return <ClaudeTabRow labels={labels} activeIndex={activeIndex} hint="⇥ Tab cycles type" />;
}

type CalendarRenderRow<T> = {
  readonly option: BrowseShellOption<T>;
  readonly optionIndex: number;
  readonly timeLabel: string;
  readonly episodeCode: string;
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly statusDim: boolean;
  readonly statusGlyph: string;
  readonly showDayHeader: boolean;
  readonly dayHeaderLabel: string | null;
  readonly showForYouHeaderOnce: boolean;
};

export function buildCalendarRenderRows<T>(
  options: readonly BrowseShellOption<T>[],
  windowStart: number,
  windowEnd: number,
  nowMs: number = Date.now(),
  selectedDayKey: string | null = null,
  showForYouHeader = false,
): readonly CalendarRenderRow<T>[] {
  const rows: CalendarRenderRow<T>[] = [];
  let lastDayHeader: string | null = null;
  let forYouHeaderShown = false;

  for (let index = windowStart; index < windowEnd; index += 1) {
    const option = options[index];
    if (!option) continue;
    const presentation = calendarReleaseRowPresentation(option, nowMs);
    const releaseState = deriveCalendarReleaseState(option, nowMs);
    const timeLabel =
      releaseState === "countdown"
        ? formatCalendarReleaseStateLabel(releaseState, option, nowMs)
        : option.previewTime?.trim() || "TBD";
    const dayHeaderLabel =
      selectedDayKey === null && option.previewGroup
        ? calendarDayKeyFromGroup(option.previewGroup)
        : null;
    const showDayHeader = dayHeaderLabel !== null && dayHeaderLabel !== lastDayHeader;
    if (showDayHeader) lastDayHeader = dayHeaderLabel;

    const badge = option.previewBadge;
    const body = option.previewBody ?? option.detail ?? "";
    const epMatch = body.match(/(?:S\d+E\d+|E\d+)/i);
    const episodeCode = badge && badge !== "wl" ? badge : (epMatch?.[0]?.toUpperCase() ?? "");

    const showForYouHeaderOnce = showForYouHeader && !forYouHeaderShown;
    if (showForYouHeaderOnce) forYouHeaderShown = true;

    rows.push({
      option,
      optionIndex: index,
      timeLabel,
      episodeCode,
      statusLabel: presentation.label,
      statusColor: presentation.color,
      statusDim: presentation.dim,
      statusGlyph: presentation.glyph.trim(),
      showDayHeader,
      dayHeaderLabel: showDayHeader ? dayHeaderLabel : null,
      showForYouHeaderOnce,
    });
  }

  return rows;
}

export function CalendarScheduleRow<T>({
  option,
  selected,
  rowWidth,
  showDayHeader,
  dayHeaderLabel,
  timeLabel,
  episodeCode,
  statusLabel,
  statusColor,
  statusDim,
  statusGlyph,
  showForYouHeader,
  showForYouHeaderOnce,
}: {
  option: BrowseShellOption<T>;
  selected: boolean;
  rowWidth: number;
  showDayHeader?: boolean;
  dayHeaderLabel?: string | null;
  timeLabel: string;
  episodeCode?: string;
  statusLabel?: string;
  statusColor?: string;
  statusDim?: boolean;
  statusGlyph?: string;
  showForYouHeader?: boolean;
  showForYouHeaderOnce?: boolean;
  showTimeHeader?: boolean;
  showTbdHeader?: boolean;
  showSectionHeader?: string | null;
  nowMs?: number;
}) {
  const presentation = calendarReleaseRowPresentation(option);
  const ep = episodeCode ?? option.previewBadge ?? "";
  const status = statusLabel ?? presentation.label;
  const color = statusColor ?? presentation.color;
  const dim = statusDim ?? presentation.dim;
  const glyph = statusGlyph ?? presentation.glyph.trim();

  const timeWidth = 7;
  const epWidth = 8;
  const statusWidth = Math.min(18, Math.max(12, Math.floor(rowWidth * 0.22)));
  const titleWidth = Math.max(12, rowWidth - timeWidth - epWidth - statusWidth - 4);

  return (
    <Box flexDirection="column" width={rowWidth} marginBottom={0}>
      {showForYouHeader && showForYouHeaderOnce ? (
        <SectionGroup label="For you · releasing today" marginTop={1} />
      ) : null}
      {showDayHeader && dayHeaderLabel ? (
        <SectionGroup label={dayHeaderLabel} marginTop={1} />
      ) : null}
      <ListRow
        selected={selected}
        rowWidth={rowWidth}
        columns={[
          listRowTimeColumn(timeLabel, timeWidth),
          listRowTitleColumn(option.label, titleWidth),
          listRowEpColumn(ep, epWidth),
          listRowStatusColumn(`${glyph} ${status}`, statusWidth, color, dim),
        ]}
      />
    </Box>
  );
}
