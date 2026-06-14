import { describe, expect, it } from "bun:test";

import { buildCalendarRenderRows } from "@/app-shell/calendar-ui.model";
import type { BrowseShellOption } from "@/app-shell/types";
import type { CalendarItem } from "@/domain/calendar/calendar-item";
import type { SearchResult } from "@/domain/types";

function option(input: {
  readonly releaseAt: string;
  readonly poster?: string;
  readonly previewImageUrl?: string;
}): BrowseShellOption<SearchResult> {
  const calendar: CalendarItem = {
    source: "anilist",
    titleId: "t1",
    title: "Show",
    contentKind: "series",
    releaseAt: input.releaseAt,
    releasePrecision: "timestamp",
    releaseStatus: "released",
    providerConfirmed: false,
    reason: "catalog-only",
    dayKey: input.releaseAt.slice(0, 10),
    poster: input.poster ?? null,
    display: { time: null, statusLabel: "", episodeCode: "", groupLabel: "" },
  };
  return {
    label: "Show",
    value: { id: "t1", type: "series", title: "Show", calendar } as unknown as SearchResult,
    calendar,
    previewImageUrl: input.previewImageUrl,
  } as BrowseShellOption<SearchResult>;
}

describe("buildCalendarRenderRows isNew + posterUrl", () => {
  const now = Date.parse("2026-06-14T12:00:00.000Z");
  const lastVisit = Date.parse("2026-06-13T00:00:00.000Z");

  it("tags rows released since the last visit as new", () => {
    const options = [
      option({ releaseAt: "2026-06-14T06:00:00.000Z" }), // fresh
      option({ releaseAt: "2026-06-12T06:00:00.000Z" }), // old
    ];
    const rows = buildCalendarRenderRows(options, 0, options.length, now, null, false, lastVisit);
    expect(rows[0]?.isNew).toBe(true);
    expect(rows[1]?.isNew).toBe(false);
  });

  it("surfaces a poster url from previewImageUrl, falling back to the calendar poster", () => {
    const options = [
      option({ releaseAt: "2026-06-14T06:00:00.000Z", previewImageUrl: "https://img/a.jpg" }),
      option({ releaseAt: "2026-06-14T07:00:00.000Z", poster: "https://img/b.jpg" }),
    ];
    const rows = buildCalendarRenderRows(options, 0, options.length, now, null, false, lastVisit);
    expect(rows[0]?.posterUrl).toBe("https://img/a.jpg");
    expect(rows[1]?.posterUrl).toBe("https://img/b.jpg");
  });
});
