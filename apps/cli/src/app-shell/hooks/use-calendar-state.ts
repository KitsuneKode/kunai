// =============================================================================
// use-calendar-state.ts — cohesive state for the calendar/schedule browse view.
//
// Consolidates calendar state and keeps it date-scoped. A caller can seed an
// initial tab so commands like /anime-calendar open pre-filtered, but the list
// always resolves to one concrete date instead of mixing date and week modes.
// =============================================================================

import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import { useCallback, useMemo, useState } from "react";

import {
  CALENDAR_TYPE_TABS,
  type CalendarDay,
  type CalendarTypeTab,
  buildCalendarDaysFromOptions,
  filterCalendarOptionsByType,
  resolveCalendarSelectedDayKey,
} from "../calendar-ui.model";

export type CalendarState = {
  readonly typeTab: CalendarTypeTab;
  /** Effective date scope. Null only while the calendar has no dated entries. */
  readonly dayFilter: string | null;
  readonly days: readonly CalendarDay[];
  /** Cycle the type tab (Tab / Shift+Tab), then select its today/first date. */
  readonly cycleType: (direction: 1 | -1) => void;
  /** Step one day earlier (-1) / later (+1), clamped at the available dates. */
  readonly stepDay: (direction: 1 | -1) => void;
  /** Reset to the default type; the effective date becomes today/first. */
  readonly reset: () => void;
  readonly setTypeTab: (tab: CalendarTypeTab) => void;
  /** Request a date; invalid or unavailable keys resolve to today/first. */
  readonly setDayFilter: (key: string | null) => void;
};

export function useCalendarState(input: {
  readonly isCalendarView: boolean;
  readonly options: readonly BrowseShellOption<SearchResult>[];
  readonly initialTypeTab?: CalendarTypeTab;
}): CalendarState {
  const { isCalendarView, options } = input;
  const [requestedDayKey, setDayFilter] = useState<string | null>(null);
  const [typeTab, setTypeTab] = useState<CalendarTypeTab>(input.initialTypeTab ?? "All");

  // Build the day strip from the TYPE-filtered options so every chip has content
  // under the active tab (otherwise selecting a chip shows "Nothing on schedule").
  const days = useMemo(() => {
    if (!isCalendarView) return [];
    return buildCalendarDaysFromOptions(filterCalendarOptionsByType(options, typeTab));
  }, [isCalendarView, options, typeTab]);

  const dayFilter = useMemo(
    () => resolveCalendarSelectedDayKey(days, requestedDayKey),
    [days, requestedDayKey],
  );

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
        const active = resolveCalendarSelectedDayKey(days, current);
        const idx = days.findIndex((day) => day.key === active);
        const target = idx + direction;
        return target >= 0 && target < days.length ? (days[target]?.key ?? active) : active;
      });
    },
    [days],
  );

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
    reset,
    setTypeTab,
    setDayFilter,
  };
}
