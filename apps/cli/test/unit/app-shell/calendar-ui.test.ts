import { expect, test } from "bun:test";

import {
  buildCalendarDaysFromOptions,
  buildCalendarErrorState,
  buildCalendarPreviewRailModel,
  buildCalendarRenderRows,
  calendarDayKeyFromGroup,
  calendarPriorityBand,
  deriveCalendarReleaseState,
  filterCalendarOptionsByType,
  formatReleaseCountdown,
  hasProviderConfirmedAvailability,
  parsePreviewTimeTodayMs,
  windowCalendarDayStrip,
} from "@/app-shell/calendar-ui.model";
import type { BrowseShellOption } from "@/app-shell/types";
import {
  buildCalendarItem,
  type CalendarContentKind,
  type CalendarReleasePrecision,
  type CalendarReleaseStatus,
} from "@/domain/calendar/calendar-item";
import type { SearchResult } from "@/domain/types";

/** Lightweight option for the day-strip/render-row tests (no structured item needed). */
function dayStripOption(partial: {
  label: string;
  previewGroup?: string;
  previewDayKey?: string;
  previewTime?: string;
  previewBadge?: string;
}): BrowseShellOption<SearchResult> {
  return {
    value: {
      id: partial.label,
      type: "series",
      title: partial.label,
      year: "2026",
      overview: "",
      posterPath: null,
    },
    label: partial.label,
    previewGroup: partial.previewGroup,
    previewDayKey: partial.previewDayKey,
    previewTime: partial.previewTime,
    previewBadge: partial.previewBadge,
  };
}

/** Builds a real structured calendar option via the production builder. */
function calOption(partial: {
  label: string;
  kind?: CalendarContentKind;
  releaseAt?: string | null;
  precision?: CalendarReleasePrecision;
  status?: CalendarReleaseStatus;
  inWatchlist?: boolean;
  providerConfirmed?: boolean;
  inHistory?: boolean;
  episode?: number;
  season?: number;
  overview?: string;
  nowMs?: number;
}): BrowseShellOption<SearchResult> {
  const kind = partial.kind ?? "anime";
  const item = buildCalendarItem(
    {
      source: kind === "anime" ? "anilist" : "tmdb",
      titleId: partial.label,
      titleName: partial.label,
      type: kind,
      season: partial.season,
      episode: partial.episode,
      releaseAt: partial.releaseAt ?? null,
      releasePrecision: partial.precision ?? "timestamp",
      status: partial.status ?? "upcoming",
    },
    {
      nowMs: partial.nowMs ?? Date.now(),
      inWatchlist: partial.inWatchlist,
      inHistory: partial.inHistory,
      providerConfirmed: partial.providerConfirmed,
    },
  );
  return {
    value: {
      id: partial.label,
      type: kind === "movie" ? "movie" : "series",
      title: partial.label,
      year: "2026",
      overview: partial.overview ?? "",
      posterPath: null,
      calendar: item,
    },
    label: partial.label,
    calendar: item,
    previewBody: partial.overview,
    previewBadge: item.display.badge,
  };
}

function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function daysAgoAt(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

test("calendarDayKeyFromGroup strips relative suffix", () => {
  expect(calendarDayKeyFromGroup("MON 19 · Today")).toBe("MON 19");
});

test("buildCalendarDaysFromOptions keeps ISO-dated days, deduped + chronological", () => {
  const options = [
    // Out of order on purpose + an undated (label-only) item that must be dropped.
    dayStripOption({ label: "C", previewGroup: "WED 3", previewDayKey: "2026-06-03" }),
    dayStripOption({ label: "A", previewGroup: "MON 1", previewDayKey: "2026-06-01" }),
    dayStripOption({ label: "A2", previewGroup: "MON 1", previewDayKey: "2026-06-01" }),
    dayStripOption({ label: "undated", previewGroup: "TBD" }),
    dayStripOption({ label: "B", previewGroup: "TUE 2 · Today", previewDayKey: "2026-06-02" }),
  ];
  const days = buildCalendarDaysFromOptions(options, true);
  expect(days.map((day) => day.key)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
});

test("windowCalendarDayStrip narrows to three days around today", () => {
  const options = [
    dayStripOption({ label: "A", previewGroup: "MON 1", previewDayKey: "2026-06-01" }),
    dayStripOption({ label: "B", previewGroup: "TUE 2 · Today", previewDayKey: "2026-06-02" }),
    dayStripOption({ label: "C", previewGroup: "WED 3", previewDayKey: "2026-06-03" }),
    dayStripOption({ label: "D", previewGroup: "THU 4", previewDayKey: "2026-06-04" }),
  ];
  const days = buildCalendarDaysFromOptions(options);
  const windowed = windowCalendarDayStrip(days, null, true);
  expect(windowed.windowDays.map((day) => day.key)).toEqual([
    "2026-06-01",
    "2026-06-02",
    "2026-06-03",
  ]);
});

test("filterCalendarOptionsByType keeps anime rows on Anime tab", () => {
  const options = [
    calOption({ label: "Anime", kind: "anime", releaseAt: todayAt(20) }),
    calOption({ label: "TV", kind: "series", releaseAt: todayAt(20), precision: "date" }),
  ];
  const filtered = filterCalendarOptionsByType(options, "Anime");
  expect(filtered.map((row) => row.label)).toEqual(["Anime"]);
});

test("filterCalendarOptionsByType keeps watchlist rows on Tracked tab", () => {
  const options = [
    calOption({ label: "Tracked", releaseAt: todayAt(20), inWatchlist: true }),
    calOption({ label: "Other", releaseAt: todayAt(20) }),
  ];
  const filtered = filterCalendarOptionsByType(options, "Tracked");
  expect(filtered.map((row) => row.label)).toEqual(["Tracked"]);
});

test("filterCalendarOptionsByType keeps watched rows on Tracked tab", () => {
  const options = [
    calOption({ label: "Watched", releaseAt: todayAt(20), inHistory: true }),
    calOption({ label: "Other", releaseAt: todayAt(20) }),
  ];
  const filtered = filterCalendarOptionsByType(options, "Tracked");
  expect(filtered.map((row) => row.label)).toEqual(["Watched"]);
});

test("deriveCalendarReleaseState treats today's catalog released as resolving", () => {
  const option = calOption({
    label: "Show",
    kind: "series",
    releaseAt: todayAt(9),
    precision: "date",
    status: "released",
  });
  expect(deriveCalendarReleaseState(option)).toBe("resolving");
});

test("deriveCalendarReleaseState treats past released rows as missed until provider confirms", () => {
  const option = calOption({
    label: "Show",
    kind: "series",
    releaseAt: daysAgoAt(3, 9),
    precision: "date",
    status: "released",
  });
  expect(deriveCalendarReleaseState(option)).toBe("missed");
});

test("deriveCalendarReleaseState reserves available for provider-confirmed rows", () => {
  const option = calOption({
    label: "Show",
    kind: "series",
    releaseAt: daysAgoAt(1, 9),
    precision: "date",
    status: "released",
    providerConfirmed: true,
  });
  expect(hasProviderConfirmedAvailability(option)).toBe(true);
  expect(deriveCalendarReleaseState(option)).toBe("available");
});

test("deriveCalendarReleaseState uses countdown for future airing-today timestamps", () => {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  const now = d.getTime();
  const option = calOption({
    label: "Show",
    releaseAt: todayAt(21),
    precision: "timestamp",
    status: "upcoming",
    nowMs: now,
  });
  expect(deriveCalendarReleaseState(option, now)).toBe("countdown");
});

test("formatReleaseCountdown prefers hours and minutes under one day", () => {
  expect(formatReleaseCountdown(3 * 60 * 60_000 + 20 * 60_000)).toBe("in 3h 20m");
});

test("formatReleaseCountdown uses days and hours at or above one day", () => {
  expect(formatReleaseCountdown(32 * 60 * 60_000 + 16 * 60_000)).toBe("in 1d 8h");
  expect(formatReleaseCountdown(49 * 60 * 60_000 + 40 * 60_000)).toBe("in 2d 1h");
  expect(formatReleaseCountdown(48 * 60 * 60_000)).toBe("in 2d");
});

test("parsePreviewTimeTodayMs parses 12-hour clock labels", () => {
  const noon = parsePreviewTimeTodayMs("12:30 PM", Date.parse("2026-05-23T08:00:00"));
  expect(noon).not.toBeNull();
  expect(new Date(noon ?? 0).getHours()).toBe(12);
});

test("parsePreviewTimeTodayMs rejects invalid clock labels", () => {
  expect(parsePreviewTimeTodayMs("25:99", Date.parse("2026-05-23T08:00:00"))).toBeNull();
});

test("buildCalendarRenderRows emits unified timestamp rows without band headers", () => {
  const options = [
    dayStripOption({ label: "Late", previewGroup: "MON 1", previewTime: "9:00 PM" }),
    dayStripOption({ label: "Also Late", previewGroup: "MON 1", previewTime: "9:00 PM" }),
    dayStripOption({ label: "Unknown", previewGroup: "MON 1" }),
  ];
  const rows = buildCalendarRenderRows(options, 0, options.length);
  expect(rows[0]?.timeLabel).toBe("9:00 PM");
  expect(rows[1]?.timeLabel).toBe("9:00 PM");
  expect(rows[2]?.timeLabel).toBe("TBD");
});

test("calendarPriorityBand prefers tracked titles in for-you", () => {
  const tracked = calOption({ label: "Tracked", releaseAt: todayAt(20), inWatchlist: true });
  const watched = calOption({ label: "Watched", releaseAt: todayAt(20), inHistory: true });
  const other = calOption({
    label: "Other",
    releaseAt: todayAt(20),
    precision: "date",
    status: "upcoming",
  });
  expect(calendarPriorityBand(tracked)).toBe("for-you");
  expect(calendarPriorityBand(watched)).toBe("for-you");
  expect(calendarPriorityBand(other)).toBe("also-today");
});

test("buildCalendarPreviewRailModel distinguishes watch-history tracking", () => {
  const option = calOption({
    label: "Watched",
    releaseAt: todayAt(20),
    inHistory: true,
  });
  const model = buildCalendarPreviewRailModel(option, "none");
  expect(model?.facts).toContainEqual({
    label: "Tracked",
    value: "watch history",
    tone: "success",
  });
});

test("buildCalendarPreviewRailModel avoids watch-now copy for resolving rows", () => {
  const option = calOption({
    label: "Show",
    kind: "series",
    releaseAt: todayAt(9),
    precision: "date",
    status: "released",
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
