// =============================================================================
// use-calendar-state.ts — cohesive state for the calendar/schedule browse view.
//
// Consolidates what used to be two loose useState slices + a derived memo + four
// scattered resets + three inline input handlers inside browse-shell. Owning them
// in one hook keeps the type-tab and day-filter invariants together (a tab change
// must clear the day filter, since the new tab has a different day strip) and lets
// a caller seed an initial tab so commands like /anime-calendar open pre-filtered.
// =============================================================================

import { useCallback, useMemo, useState } from "react";

import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";

import {
  CALENDAR_TYPE_TABS,
  type CalendarDay,
  type CalendarTypeTab,
  buildCalendarDaysFromOptions,
  filterCalendarOptionsByType,
} from "../calendar-ui.model";

export type CalendarState = {
  readonly typeTab: CalendarTypeTab;
  readonly dayFilter: string | null;
  readonly days: readonly CalendarDay[];
  /** Cycle the type tab (Tab / Shift+Tab). Clears the day filter — the new tab has a different strip. */
  readonly cycleType: (direction: 1 | -1) => void;
  /** Step one day earlier (-1) / later (+1). From "all days" enters at today (or first), clamped at ends. */
  readonly stepDay: (direction: 1 | -1) => void;
  /** Toggle all-days ⇄ day-by-day. */
  readonly toggleAllDays: () => void;
  /** Reset to the default view (all types, all days) — used when results clear / re-search. */
  readonly reset: () => void;
  readonly setTypeTab: (tab: CalendarTypeTab) => void;
  readonly setDayFilter: (key: string | null) => void;
};

export function useCalendarState(input: {
  readonly isCalendarView: boolean;
  readonly options: readonly BrowseShellOption<SearchResult>[];
  readonly initialTypeTab?: CalendarTypeTab;
}): CalendarState {
  const { isCalendarView, options } = input;
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [typeTab, setTypeTab] = useState<CalendarTypeTab>(input.initialTypeTab ?? "All");

  // Build the day strip from the TYPE-filtered options so every chip has content
  // under the active tab (otherwise selecting a chip shows "Nothing on schedule").
  const days = useMemo(() => {
    if (!isCalendarView) return [];
    return buildCalendarDaysFromOptions(filterCalendarOptionsByType(options, typeTab));
  }, [isCalendarView, options, typeTab]);

  const cycleType = useCallback((direction: 1 | -1) => {
    setTypeTab((current) => {
      const idx = CALENDAR_TYPE_TABS.indexOf(current);
      const next = (idx + direction + CALENDAR_TYPE_TABS.length) % CALENDAR_TYPE_TABS.length;
      return CALENDAR_TYPE_TABS[next] ?? "All";
    });
    setDayFilter(null);
  }, []);

  const stepDay = useCallback(
    (direction: 1 | -1) => {
      setDayFilter((current) => {
        if (days.length === 0) return current;
        if (current === null) {
          // Enter at today (or the first day) — never jump to the furthest-future day.
          return days.find((day) => day.isToday)?.key ?? days[0]?.key ?? null;
        }
        const idx = days.findIndex((day) => day.key === current);
        const target = idx + direction;
        return target >= 0 && target < days.length ? (days[target]?.key ?? current) : current;
      });
    },
    [days],
  );

  const toggleAllDays = useCallback(() => {
    setDayFilter((current) => (current === null ? (days[0]?.key ?? null) : null));
  }, [days]);

  const reset = useCallback(() => {
    setDayFilter(null);
    setTypeTab("All");
  }, []);

  return {
    typeTab,
    dayFilter,
    days,
    cycleType,
    stepDay,
    toggleAllDays,
    reset,
    setTypeTab,
    setDayFilter,
  };
}
