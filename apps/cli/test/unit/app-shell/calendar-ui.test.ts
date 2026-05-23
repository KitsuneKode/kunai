import { expect, test } from "bun:test";

import {
  buildCalendarDaysFromOptions,
  buildCalendarRenderRows,
  buildCalendarPreviewRailModel,
  buildCalendarErrorState,
  calendarDayKeyFromGroup,
  calendarPriorityBand,
  deriveCalendarReleaseState,
  filterCalendarOptionsByType,
  formatReleaseCountdown,
  hasProviderConfirmedAvailability,
  parsePreviewTimeTodayMs,
} from "@/app-shell/calendar-ui";
import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";

function calendarOption(
  partial: Partial<SearchResult> & {
    label: string;
    previewGroup: string;
    releaseStatus?: "released" | "airing-today" | "upcoming";
    displayTime?: string;
    previewBadge?: string;
  },
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
      displayReleaseStatus: partial.releaseStatus,
    },
    label: partial.label,
    previewGroup: partial.previewGroup,
    previewTime: partial.displayTime,
    previewBadge: partial.previewBadge,
    releaseStatus: partial.releaseStatus,
    previewBody: partial.overview,
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

test("filterCalendarOptionsByType keeps watchlist rows on Tracked tab", () => {
  const options = [
    calendarOption({ label: "Tracked", previewGroup: "MON 1", previewBadge: "wl" }),
    calendarOption({ label: "Other", previewGroup: "MON 1" }),
  ];
  const filtered = filterCalendarOptionsByType(options, "Tracked");
  expect(filtered.map((row) => row.label)).toEqual(["Tracked"]);
});

test("deriveCalendarReleaseState treats today's catalog released as resolving", () => {
  const option = calendarOption({
    label: "Show",
    previewGroup: "MON 1 · Today",
    releaseStatus: "released",
  });
  expect(deriveCalendarReleaseState(option)).toBe("resolving");
});

test("deriveCalendarReleaseState treats past released rows as missed until provider confirms", () => {
  const option = calendarOption({
    label: "Show",
    previewGroup: "MON 1",
    releaseStatus: "released",
  });
  expect(deriveCalendarReleaseState(option)).toBe("missed");
});

test("deriveCalendarReleaseState reserves available for provider-confirmed rows", () => {
  const option = calendarOption({
    label: "Show",
    previewGroup: "MON 1",
    releaseStatus: "released",
  });
  const confirmed = {
    ...option,
    previewFacts: [
      { label: "Availability", detail: "provider confirmed", tone: "success" as const },
    ],
  };
  expect(hasProviderConfirmedAvailability(confirmed)).toBe(true);
  expect(deriveCalendarReleaseState(confirmed)).toBe("available");
});

test("deriveCalendarReleaseState uses countdown for future airing-today timestamps", () => {
  const now = Date.parse("2026-05-23T10:00:00");
  const option = calendarOption({
    label: "Show",
    previewGroup: "MON 1 · Today",
    releaseStatus: "airing-today",
    displayTime: "9:00 PM",
  });
  expect(deriveCalendarReleaseState(option, now)).toBe("countdown");
});

test("formatReleaseCountdown prefers hours and minutes", () => {
  expect(formatReleaseCountdown(3 * 60 * 60_000 + 20 * 60_000)).toBe("in 3h 20m");
});

test("parsePreviewTimeTodayMs parses 12-hour clock labels", () => {
  const noon = parsePreviewTimeTodayMs("12:30 PM", Date.parse("2026-05-23T08:00:00"));
  expect(noon).not.toBeNull();
  expect(new Date(noon ?? 0).getHours()).toBe(12);
});

test("parsePreviewTimeTodayMs rejects invalid clock labels", () => {
  expect(parsePreviewTimeTodayMs("25:99", Date.parse("2026-05-23T08:00:00"))).toBeNull();
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

test("calendarPriorityBand prefers tracked titles in for-you", () => {
  const tracked = calendarOption({ label: "Tracked", previewGroup: "MON 1", previewBadge: "wl" });
  const other = calendarOption({
    label: "Other",
    previewGroup: "MON 1",
    releaseStatus: "airing-today",
  });
  expect(calendarPriorityBand(tracked)).toBe("for-you");
  expect(calendarPriorityBand(other)).toBe("also-today");
});

test("buildCalendarPreviewRailModel avoids watch-now copy for resolving rows", () => {
  const option = calendarOption({
    label: "Show",
    previewGroup: "MON 1 · Today",
    releaseStatus: "released",
    overview: "S01E02",
  });
  const model = buildCalendarPreviewRailModel(option, "none");
  expect(model?.overview).toContain("will not offer playback until a provider source is available");
  expect(model?.facts.some((fact) => fact.value.includes("Watch now"))).toBe(false);
});

test("buildCalendarErrorState offers catalog refresh without provider lookup", () => {
  const model = buildCalendarErrorState("network failed");
  expect(model.actions?.[0]).toMatchObject({
    id: "retry-calendar",
    detail: "Retry catalog metadata without touching providers",
  });
});
