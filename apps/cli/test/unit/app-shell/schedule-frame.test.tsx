import { expect, test } from "bun:test";

import { CalendarScheduleRow } from "@/app-shell/calendar-ui";
import {
  buildCalendarRenderRows,
  calendarRowLineCost,
  windowCalendarRowsByLines,
} from "@/app-shell/calendar-ui.model";
import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import { Box } from "ink";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

// Build the ESC matcher without a literal control char (oxlint no-control-regex).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

function scheduleOption(label: string, dayKey: string): BrowseShellOption<SearchResult> {
  return {
    label,
    value: { id: label, type: "series", title: label } as SearchResult,
    calendar: {
      contentKind: "anime",
      providerConfirmed: false,
      releaseStatus: "known",
      dayKey,
      display: {
        statusLabel: "aired · resolving",
        time: "6:00 PM",
        groupLabel: dayKey,
        episodeCode: "E10",
      },
    },
  } as unknown as BrowseShellOption<SearchResult>;
}

const DAYS = ["2026-06-11", "2026-06-18", "2026-06-22"];
const OPTIONS = DAYS.flatMap((day, d) =>
  Array.from({ length: 6 }, (_, i) => scheduleOption(`Title ${d}-${i} A Fairly Long Name`, day)),
);

function buildRows() {
  return buildCalendarRenderRows(
    OPTIONS,
    0,
    OPTIONS.length,
    Date.parse("2026-06-11T00:00:00"),
    null,
    true,
  );
}

function renderSchedule(rowWidth: number, maxLines: number): string {
  const rows = buildRows();
  const win = windowCalendarRowsByLines(rows, 0, maxLines);
  const node = (
    <Box flexDirection="column" width={rowWidth + 4}>
      {rows.slice(win.start, win.end).map((row) => (
        <CalendarScheduleRow
          key={`${row.option.label}-${row.optionIndex}`}
          option={row.option}
          selected={row.optionIndex === 0}
          rowWidth={rowWidth}
          timeLabel={row.timeLabel}
          episodeCode={row.episodeCode}
          statusLabel={row.statusLabel}
          statusColor="#cccccc"
          statusDim={row.statusDim}
          statusGlyph={row.statusGlyph}
          showDayHeader={row.showDayHeader}
          dayHeaderLabel={row.dayHeaderLabel}
          weekTag={row.weekTag}
          showForYouHeader
          showForYouHeaderOnce={row.showForYouHeaderOnce}
        />
      ))}
    </Box>
  );
  return captureFrame(node, { columns: Math.max(120, rowWidth + 20) }).replace(ANSI, "");
}

test.each([56, 90, 116])("schedule has no detached rule lines at rowWidth=%i", (rowWidth) => {
  const frame = renderSchedule(rowWidth, 30);
  const detached = frame.split("\n").filter((l) => l.trim().length > 0 && /^─+$/.test(l.trim()));
  expect(detached).toHaveLength(0);
});

test("schedule window respects a short line budget", () => {
  const rows = buildRows();
  const win = windowCalendarRowsByLines(rows, 0, 8);
  const used = rows.slice(win.start, win.end).reduce((sum, r) => sum + calendarRowLineCost(r), 0);
  expect(used).toBeLessThanOrEqual(8);
  expect(win.end).toBeGreaterThan(win.start);
});

test("day header carries the week tag inline (no standalone week band)", () => {
  const frame = renderSchedule(90, 30);
  // A line that is only an uppercased week label would be the old standalone band.
  const standaloneWeek = frame
    .split("\n")
    .some((l) => /^\s*(THIS WEEK|NEXT WEEK|WEEK OF)\b/.test(l));
  expect(standaloneWeek).toBe(false);
});
