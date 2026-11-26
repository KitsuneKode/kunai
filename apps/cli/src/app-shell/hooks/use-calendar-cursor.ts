// The schedule's cursor: which date is showing and which row on it is selected.
//
// Keys and taps share it. Ink drains a burst of raw stdin before React paints,
// so the intended row lives in `cursorRef` (owned by the browse shell) rather
// than in state; every move here writes that ref first, then the state.

import type { BrowseShellOption } from "@/app-shell/types";
import { useCallback, useMemo, useRef, type MutableRefObject } from "react";

import type { CalendarDay, CalendarTypeTab } from "../calendar-ui.model";
import { decideRowTap } from "../mouse/row-tap";

export type CalendarKeyboardCursor<T> = {
  dayKey: string | null;
  optionIndex: number;
  option: BrowseShellOption<T> | null;
};

export type CalendarCursorInput<T> = {
  readonly cursorRef: MutableRefObject<CalendarKeyboardCursor<T>>;
  readonly dayFilter: string | null;
  readonly days: readonly CalendarDay[];
  readonly optionsForDay: (dayKey: string | null) => readonly BrowseShellOption<T>[];
  readonly setDayFilter: (dayKey: string | null) => void;
  readonly setTypeTab: (tab: CalendarTypeTab) => void;
  readonly setSelectedIndex: (index: number) => void;
  readonly focusList: () => void;
  /** A second tap on the selected row: the same as Enter. */
  readonly submit: (option: BrowseShellOption<T>) => void;
};

export type CalendarCursor = {
  /** ←/→: step to the previous or next date that has releases. */
  readonly moveDay: (direction: 1 | -1) => void;
  /** ↑/↓: step through the date's rows, wrapping at either end. */
  readonly moveRow: (direction: 1 | -1) => void;
  /** Tap on a date chip. */
  readonly selectDay: (dayKey: string) => void;
  /** Tap on a type tab: the same reset Tab does (first date, first row). */
  readonly selectType: (tab: CalendarTypeTab) => void;
  /** Tap on a row: select it, or act like Enter when it is already selected. */
  readonly tapRow: (optionIndex: number, selected: boolean) => void;
  /** Wheel over the rows: like ↑/↓, but stops at either end. */
  readonly wheel: (direction: "up" | "down") => void;
};

/**
 * The returned callbacks are stable across renders — calendar rows are
 * memoized, and a fresh handler per render would re-render every row on each
 * cursor move. They read the latest input through a ref.
 */
export function useCalendarCursor<T>(input: CalendarCursorInput<T>): CalendarCursor {
  const latest = useRef(input);
  latest.current = input;
  const previousTap = useRef<BrowseShellOption<T> | null>(null);

  const selectDay = useCallback((dayKey: string) => {
    const { cursorRef, optionsForDay, setDayFilter, setSelectedIndex } = latest.current;
    cursorRef.current = { dayKey, optionIndex: 0, option: optionsForDay(dayKey)[0] ?? null };
    setDayFilter(dayKey);
    setSelectedIndex(0);
  }, []);

  const placeRow = useCallback((optionIndex: number) => {
    const { cursorRef, dayFilter, optionsForDay, setSelectedIndex, focusList } = latest.current;
    const dayKey = cursorRef.current.dayKey ?? dayFilter;
    cursorRef.current = {
      dayKey,
      optionIndex,
      option: optionsForDay(dayKey)[optionIndex] ?? null,
    };
    focusList();
    setSelectedIndex(optionIndex);
  }, []);

  /** Row count and cursor on the date the cursor is on, or null when it is empty. */
  const currentRow = useCallback(() => {
    const { cursorRef, dayFilter, optionsForDay } = latest.current;
    const count = optionsForDay(cursorRef.current.dayKey ?? dayFilter).length;
    if (count === 0) return null;
    return { count, index: Math.min(Math.max(0, cursorRef.current.optionIndex), count - 1) };
  }, []);

  return useMemo<CalendarCursor>(
    () => ({
      moveDay: (direction) => {
        const { cursorRef, dayFilter, days } = latest.current;
        const currentDay = cursorRef.current.dayKey ?? dayFilter;
        const currentIndex = days.findIndex((day) => day.key === currentDay);
        const targetDay = days[currentIndex + direction]?.key;
        if (targetDay) selectDay(targetDay);
      },
      moveRow: (direction) => {
        const row = currentRow();
        if (row) placeRow((row.index + direction + row.count) % row.count);
      },
      selectDay,
      selectType: (tab) => {
        const { setTypeTab, setDayFilter, setSelectedIndex } = latest.current;
        setTypeTab(tab);
        setDayFilter(null);
        setSelectedIndex(0);
      },
      tapRow: (optionIndex, selected) => {
        const { cursorRef, dayFilter, optionsForDay, submit } = latest.current;
        const option = optionsForDay(cursorRef.current.dayKey ?? dayFilter)[optionIndex];
        if (!option) return;
        const decision = decideRowTap(previousTap.current, option, selected);
        previousTap.current = decision.nextPreviousTap;
        if (decision.outcome === "activate") submit(option);
        else placeRow(optionIndex);
      },
      wheel: (direction) => {
        const row = currentRow();
        if (!row) return;
        placeRow(Math.max(0, Math.min(row.count - 1, row.index + (direction === "up" ? -1 : 1))));
      },
    }),
    [currentRow, placeRow, selectDay],
  );
}
