import { describe, expect, it } from "bun:test";

import {
  calendarReleaseRowPresentation,
  deriveCalendarReleaseState,
  isReleaseNew,
} from "@/app-shell/calendar-ui.model";
import type { BrowseShellOption } from "@/app-shell/types";
import type { CalendarItem } from "@/domain/calendar/calendar-item";
import type { SearchResult } from "@/domain/types";

const NOW = Date.parse("2026-06-14T12:00:00.000Z");

/** Build a calendar BrowseShellOption with a CalendarItem the model can read. */
function option(
  over: Partial<CalendarItem> & { releaseAt?: string | null },
): BrowseShellOption<SearchResult> {
  const calendar: CalendarItem = {
    source: "anilist",
    titleId: "t1",
    title: "Show",
    contentKind: "series",
    releaseAt: over.releaseAt ?? null,
    releasePrecision: "timestamp",
    releaseStatus: "upcoming",
    providerConfirmed: false,
    reason: "upcoming-episode",
    dayKey: null,
    display: { time: null, statusLabel: "", episodeCode: "", groupLabel: "" },
    ...over,
  };
  return {
    label: "Show",
    value: { id: "t1", type: "series", title: "Show", calendar } as unknown as SearchResult,
    calendar,
  } as BrowseShellOption<SearchResult>;
}

describe("deriveCalendarReleaseState boundaries", () => {
  it("future timestamp release is a countdown", () => {
    const state = deriveCalendarReleaseState(
      option({ releaseAt: "2026-06-14T14:00:00.000Z" }),
      NOW,
    );
    expect(state).toBe("countdown");
  });

  it("just-passed upcoming-episode is resolving (aired, source pending)", () => {
    const state = deriveCalendarReleaseState(
      option({ releaseAt: "2026-06-14T11:59:00.000Z" }),
      NOW,
    );
    expect(state).toBe("resolving");
  });

  it("provider-confirmed release is available", () => {
    const state = deriveCalendarReleaseState(
      option({
        releaseAt: "2026-06-14T08:00:00.000Z",
        providerConfirmed: true,
        releaseStatus: "released",
        reason: "provider-confirmed",
      }),
      NOW,
    );
    expect(state).toBe("available");
  });

  it("aired catalog-only release on a past day is missed", () => {
    const state = deriveCalendarReleaseState(
      option({
        releaseAt: "2026-06-12T08:00:00.000Z",
        releaseStatus: "released",
        reason: "catalog-only",
        dayKey: "2026-06-12",
      }),
      NOW,
    );
    expect(state).toBe("missed");
  });
});

describe("calendarReleaseRowPresentation labels", () => {
  it("countdown label reads as a relative time", () => {
    const p = calendarReleaseRowPresentation(
      option({ releaseAt: "2026-06-14T14:00:00.000Z" }),
      NOW,
    );
    expect(p.label.toLowerCase()).toContain("in ");
  });

  it("just-passed release is not a zero countdown", () => {
    const p = calendarReleaseRowPresentation(
      option({ releaseAt: "2026-06-14T11:59:00.000Z" }),
      NOW,
    );
    expect(p.label.toLowerCase()).not.toContain("in 0");
  });
});

describe("isReleaseNew", () => {
  const lastVisit = Date.parse("2026-06-13T00:00:00.000Z");
  const now = Date.parse("2026-06-14T12:00:00.000Z");

  it("is new when released after the last visit and on/before now", () => {
    expect(isReleaseNew(option({ releaseAt: "2026-06-14T06:00:00.000Z" }), lastVisit, now)).toBe(
      true,
    );
  });

  it("is not new when released before the last visit", () => {
    expect(isReleaseNew(option({ releaseAt: "2026-06-12T06:00:00.000Z" }), lastVisit, now)).toBe(
      false,
    );
  });

  it("is not new for a future release", () => {
    expect(isReleaseNew(option({ releaseAt: "2026-06-20T06:00:00.000Z" }), lastVisit, now)).toBe(
      false,
    );
  });

  it("is not new when there is no last visit (0) to avoid flooding first run", () => {
    expect(isReleaseNew(option({ releaseAt: "2026-06-14T06:00:00.000Z" }), 0, now)).toBe(false);
  });
});
