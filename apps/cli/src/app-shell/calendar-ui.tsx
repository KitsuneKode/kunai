import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import { Box, Text } from "ink";
import React from "react";

import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";

export type CalendarDay = {
  readonly key: string;
  readonly label: string;
  readonly isToday: boolean;
};

export type CalendarTypeTab = "All" | "Anime" | "TV" | "Movies";

export const CALENDAR_TYPE_TABS: readonly CalendarTypeTab[] = [
  "All",
  "Anime",
  "TV",
  "Movies",
] as const;

export function isCalendarBrowseOption<T>(option: BrowseShellOption<T> | undefined): boolean {
  return Boolean(option?.previewGroup);
}

export function buildCalendarDaysFromOptions<T>(
  options: readonly BrowseShellOption<T>[],
  narrow: boolean,
): readonly CalendarDay[] {
  const seen = new Set<string>();
  const days: CalendarDay[] = [];
  for (const option of options) {
    const group = option.previewGroup;
    if (!group) continue;
    const key = calendarDayKeyFromGroup(group);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const isToday = group.includes("Today");
    days.push({ key, label: key, isToday });
  }

  if (!narrow || days.length <= 3) {
    return days;
  }

  const todayIndex = days.findIndex((day) => day.isToday);
  if (todayIndex < 0) {
    return days.slice(0, 3);
  }
  const start = Math.max(0, todayIndex - 1);
  return days.slice(start, start + 3);
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
    if (!option.previewGroup) return false;
    return calendarDayKeyFromGroup(option.previewGroup) === dayKey;
  });
}

export function filterCalendarOptionsByType(
  options: readonly BrowseShellOption<SearchResult>[],
  tab: CalendarTypeTab,
): readonly BrowseShellOption<SearchResult>[] {
  if (tab === "All") return options;
  return options.filter((option) => matchesCalendarType(option.value, tab));
}

function matchesCalendarType(result: SearchResult, tab: CalendarTypeTab): boolean {
  const source = result.metadataSource?.toLowerCase() ?? "";
  if (tab === "Movies") return result.type === "movie";
  if (tab === "Anime") return source.includes("anilist");
  if (tab === "TV") return result.type === "series" && source.includes("tmdb");
  return true;
}

export function CalendarDayStrip({
  days,
  selectedDayKey,
}: {
  days: readonly CalendarDay[];
  selectedDayKey: string | null;
}) {
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box flexDirection="row" flexWrap="wrap" alignItems="flex-start">
        <Text color={palette.dim} dimColor>
          {"← "}
        </Text>
        {days.map((day) => {
          const isSelected = selectedDayKey === day.key;
          const showTodayMarker = day.isToday;
          const activeColor = day.isToday ? palette.amber : palette.teal;
          return (
            <Box key={day.key} marginRight={2} flexDirection="column">
              <Text
                color={isSelected ? activeColor : showTodayMarker ? palette.amber : palette.muted}
                bold={isSelected || showTodayMarker}
              >
                {showTodayMarker ? "◉ " : isSelected ? "● " : "  "}
                {day.label}
              </Text>
              {isSelected ? (
                <Text color={activeColor}>{"─".repeat(Math.min(day.label.length + 2, 12))}</Text>
              ) : null}
            </Box>
          );
        })}
        <Text color={palette.dim} dimColor>
          {" →"}
        </Text>
        <Box marginLeft={2}>
          <Text color={palette.dim} dimColor>
            {selectedDayKey !== null ? "esc · all days" : "← → filter day"}
          </Text>
        </Box>
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
  return (
    <Box flexDirection="row" marginTop={1} marginBottom={1}>
      {CALENDAR_TYPE_TABS.map((tab) => {
        const active = tab === activeTab;
        return (
          <Box key={tab} marginRight={3} flexDirection="column">
            <Text color={active ? palette.amber : palette.muted}>{tab}</Text>
            {active ? <Text color={palette.amber}>{"─".repeat(tab.length)}</Text> : null}
          </Box>
        );
      })}
      <Text color={palette.dim} dimColor>
        {"1–4 filter type"}
      </Text>
    </Box>
  );
}

type CalendarRenderRow<T> = {
  readonly option: BrowseShellOption<T>;
  readonly optionIndex: number;
  readonly showTimeHeader: boolean;
  readonly showTbdHeader: boolean;
  readonly timeLabel: string;
};

export function buildCalendarRenderRows<T>(
  options: readonly BrowseShellOption<T>[],
  windowStart: number,
  windowEnd: number,
): readonly CalendarRenderRow<T>[] {
  const timed: CalendarRenderRow<T>[] = [];
  const tbd: CalendarRenderRow<T>[] = [];
  let lastTime: string | null = null;
  let tbdHeaderAdded = false;

  for (let index = windowStart; index < windowEnd; index += 1) {
    const option = options[index];
    if (!option) continue;
    const timeLabel = option.previewTime?.trim() ?? "";
    const isTbd = timeLabel.length === 0;

    if (isTbd) {
      tbd.push({
        option,
        optionIndex: index,
        showTimeHeader: false,
        showTbdHeader: !tbdHeaderAdded,
        timeLabel: "",
      });
      tbdHeaderAdded = true;
      continue;
    }

    const showTimeHeader = timeLabel !== lastTime;
    lastTime = timeLabel;
    timed.push({
      option,
      optionIndex: index,
      showTimeHeader,
      showTbdHeader: false,
      timeLabel,
    });
  }

  return [...timed, ...tbd];
}

export function CalendarScheduleRow<T>({
  option,
  selected,
  rowWidth,
  showTimeHeader,
  showTbdHeader,
  timeLabel,
}: {
  option: BrowseShellOption<T>;
  selected: boolean;
  rowWidth: number;
  showTimeHeader: boolean;
  showTbdHeader: boolean;
  timeLabel: string;
}) {
  const title = truncateLine(option.label, Math.max(16, rowWidth - 14));
  const detail = option.detail ? truncateLine(option.detail, rowWidth - 4) : "";
  // Release facts, not playable guarantees: ✓ released · ▶ airing today · ○ upcoming.
  const status =
    option.releaseStatus === "released"
      ? { glyph: "✓ ", color: palette.green, dim: true }
      : option.releaseStatus === "airing-today"
        ? { glyph: "▶ ", color: palette.amber, dim: false }
        : { glyph: "○ ", color: palette.muted, dim: true };

  return (
    <Box flexDirection="column" width={rowWidth} marginBottom={0}>
      {showTimeHeader ? (
        <Box marginTop={1} marginBottom={0}>
          <Text color={palette.amber} bold>
            {timeLabel}
          </Text>
        </Box>
      ) : null}
      {showTbdHeader ? (
        <Box marginTop={1} marginBottom={0}>
          <Text color={palette.dim} dimColor>
            time tbd
          </Text>
        </Box>
      ) : null}
      <Box
        width={rowWidth}
        flexDirection="column"
        backgroundColor={selected ? palette.surfaceActive : undefined}
      >
        <Text bold={selected} dimColor={!selected} wrap="truncate">
          <Text color={selected ? palette.amber : palette.gray}>{selected ? "▌ " : "  "}</Text>
          <Text color={status.color} dimColor={status.dim}>
            {status.glyph}
          </Text>
          <Text color={selected ? "white" : undefined}>{title}</Text>
          {option.previewBadge ? (
            <Text color={palette.dim}> {`· ${option.previewBadge}`}</Text>
          ) : null}
        </Text>
        {detail ? (
          <Text color={palette.dim} dimColor>
            {"    "}
            {detail}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
