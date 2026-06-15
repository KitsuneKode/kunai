import { expect, test } from "bun:test";

import { sortCalendarOptions } from "@/app-shell/calendar-view";
import type { BrowseShellOption } from "@/app-shell/types";
import { buildCalendarItem } from "@/domain/calendar/calendar-item";
import type { SearchResult } from "@/domain/types";

function calendarOption(input: {
  readonly label: string;
  readonly releaseAt: string;
  readonly inWatchlist?: boolean;
  readonly inHistory?: boolean;
}): BrowseShellOption<SearchResult> {
  const calendar = buildCalendarItem(
    {
      source: "anilist",
      titleId: input.label,
      titleName: input.label,
      type: "anime",
      episode: 1,
      releaseAt: input.releaseAt,
      releasePrecision: "timestamp",
      status: "upcoming",
    },
    {
      nowMs: Date.now(),
      inWatchlist: input.inWatchlist,
      inHistory: input.inHistory,
    },
  );
  return {
    value: {
      id: input.label,
      type: "series",
      title: input.label,
      year: "2026",
      overview: "",
      posterPath: null,
      calendar,
    },
    label: input.label,
    calendar,
    previewBadge: calendar.display.badge,
  };
}

test("sortCalendarOptions orders one chronological timeline, not tracked-first", () => {
  const now = Date.now();
  const genericSoon = calendarOption({
    label: "Generic Soon",
    releaseAt: new Date(now + 30 * 60 * 1000).toISOString(),
  });
  const trackedLater = calendarOption({
    label: "Tracked Later",
    releaseAt: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    inWatchlist: true,
  });
  const historyLater = calendarOption({
    label: "History Later",
    releaseAt: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
    inHistory: true,
  });

  // Earliest air first regardless of tracked state — tracked items are marked inline,
  // not hoisted, so the day/week headers stay in order.
  expect(
    sortCalendarOptions([trackedLater, historyLater, genericSoon]).map((option) => option.label),
  ).toEqual(["Generic Soon", "Tracked Later", "History Later"]);
});
