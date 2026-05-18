import { expect, test } from "bun:test";

import {
  buildCalendarDaysFromOptions,
  buildCalendarRenderRows,
  calendarDayKeyFromGroup,
  filterCalendarOptionsByType,
} from "@/app-shell/calendar-ui";
import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";

function calendarOption(
  partial: Partial<SearchResult> & { label: string; previewGroup: string },
): BrowseShellOption<SearchResult> {
  return {
    value: {
      id: partial.id ?? "1",
      type: partial.type ?? "series",
      title: partial.label,
      year: partial.year ?? "2026",
      overview: partial.overview ?? "",
      posterPath: null,
      metadataSource: partial.metadataSource ?? "AniList calendar · Today · airs today · timestamp",
      displayGroup: partial.previewGroup,
      displayTime: partial.displayTime,
    },
    label: partial.label,
    previewGroup: partial.previewGroup,
    previewTime: partial.displayTime,
  };
}

test("calendarDayKeyFromGroup strips relative suffix", () => {
  expect(calendarDayKeyFromGroup("MON 19 · Today")).toBe("MON 19");
});

test("buildCalendarDaysFromOptions narrows to three days around today", () => {
  const options = [
    calendarOption({ label: "A", previewGroup: "MON 1" }),
    calendarOption({ label: "B", previewGroup: "TUE 2 · Today" }),
    calendarOption({ label: "C", previewGroup: "WED 3" }),
    calendarOption({ label: "D", previewGroup: "THU 4" }),
  ];
  const days = buildCalendarDaysFromOptions(options, true);
  expect(days.map((day) => day.key)).toEqual(["MON 1", "TUE 2", "WED 3"]);
});

test("filterCalendarOptionsByType keeps anime rows on Anime tab", () => {
  const options = [
    calendarOption({
      label: "Anime",
      previewGroup: "MON 1",
      metadataSource: "AniList calendar · Today · airs today · timestamp",
    }),
    calendarOption({
      label: "TV",
      previewGroup: "MON 1",
      metadataSource: "TMDB calendar · Today · airs today · timestamp",
      type: "series",
    }),
  ];
  const filtered = filterCalendarOptionsByType(options, "Anime");
  expect(filtered.map((row) => row.label)).toEqual(["Anime"]);
});

test("buildCalendarRenderRows groups timed headers and tbd bucket", () => {
  const options = [
    calendarOption({ label: "Late", previewGroup: "MON 1", displayTime: "9:00 PM" }),
    calendarOption({ label: "Also Late", previewGroup: "MON 1", displayTime: "9:00 PM" }),
    calendarOption({ label: "Unknown", previewGroup: "MON 1" }),
  ];
  const rows = buildCalendarRenderRows(options, 0, options.length);
  expect(rows[0]?.showTimeHeader).toBe(true);
  expect(rows[1]?.showTimeHeader).toBe(false);
  expect(rows[2]?.showTbdHeader).toBe(true);
});
