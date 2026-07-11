import type {
  PreviewPosterState,
  PreviewRailModel,
} from "@/app-shell/primitives/PreviewRail.model";
import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";

import type { StateBlockModel } from "./primitives/StateBlock.model";
import { RETURN_LOOP_CALENDAR_EMPTY_TAIL } from "./return-loop-copy";
import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";

export type CalendarDay = {
  readonly key: string;
  readonly label: string;
  readonly isToday: boolean;
};

export type CalendarTypeTab = "All" | "Anime" | "TV" | "Movies" | "Tracked";

export const CALENDAR_TYPE_TABS: readonly CalendarTypeTab[] = [
  "All",
  "Anime",
  "TV",
  "Movies",
  "Tracked",
] as const;

/** Broadcast / schedule state — not the same as provider playability. */
export type CalendarReleaseState =
  | "available"
  | "continue-ready"
  | "countdown"
  | "resolving"
  | "missed"
  | "upcoming"
  | "failed";

export type CalendarPriorityBand = "for-you" | "also-today" | "later";

export type CalendarRenderRow<T> = {
  readonly option: BrowseShellOption<T>;
  readonly optionIndex: number;
  readonly timeLabel: string;
  readonly episodeCode: string;
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly statusDim: boolean;
  readonly statusGlyph: string;
  /** Quiet week marker shown inline on the day header when the week changes. */
  readonly weekTag: string | null;
  readonly showDayHeader: boolean;
  readonly dayHeaderLabel: string | null;
  readonly showForYouHeaderOnce: boolean;
  /** True when this release aired since the user last opened the calendar. */
  readonly isNew: boolean;
  /** True when the title is on the user's watchlist or in their history (for-you). */
  readonly tracked: boolean;
  /** Poster URL for the row's mini-poster (falls back to the calendar poster). */
  readonly posterUrl?: string;
};

const CALENDAR_WEEKDAY_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: "short" });

function isCalendarTrackedOption<T>(option: BrowseShellOption<T>): boolean {
  return (
    option.calendar?.inWatchlist === true ||
    option.calendar?.inHistory === true ||
    option.previewBadge === "wl"
  );
}

export function calendarPriorityBand<T>(option: BrowseShellOption<T>): CalendarPriorityBand {
  if (isCalendarTrackedOption(option)) return "for-you";
  const state = deriveCalendarReleaseState(option);
  if (state === "upcoming") return "later";
  return "also-today";
}

export function buildCalendarDaysFromOptions<T>(
  options: readonly BrowseShellOption<T>[],
  _narrow?: boolean,
): readonly CalendarDay[] {
  const seen = new Set<string>();
  const days: CalendarDay[] = [];
  for (const option of options) {
    const group = option.calendar?.display.groupLabel ?? option.previewGroup;
    const key =
      option.calendar?.dayKey ??
      option.previewDayKey ??
      (group ? calendarDayKeyFromGroup(group) : null);
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    const isToday = group?.includes("Today") ?? false;
    days.push({ key, label: calendarDayLabelFromIsoKey(key), isToday });
  }
  days.sort((a, b) => a.key.localeCompare(b.key));
  return days;
}

/**
 * Calendar is intentionally date-scoped. A stale requested key falls back to
 * today (or the earliest available date) when a type filter changes its strip.
 */
export function resolveCalendarSelectedDayKey(
  days: readonly CalendarDay[],
  requestedDayKey: string | null,
): string | null {
  if (requestedDayKey && days.some((day) => day.key === requestedDayKey)) {
    return requestedDayKey;
  }
  return days.find((day) => day.isToday)?.key ?? days[0]?.key ?? null;
}

/** "2026-09-07" -> "SUN 7" (weekday + day-of-month, from the ISO key, local tz). */
function calendarDayLabelFromIsoKey(isoKey: string): string {
  const date = new Date(`${isoKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoKey;
  const weekday = CALENDAR_WEEKDAY_FORMATTER.format(date).toUpperCase();
  return `${weekday} ${date.getDate()}`;
}

export function windowCalendarDayStrip(
  days: readonly CalendarDay[],
  selectedDayKey: string | null,
  narrow: boolean,
): {
  readonly windowDays: readonly CalendarDay[];
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
} {
  const visible = narrow ? 3 : 4;
  const activeIndex = Math.max(
    0,
    days.findIndex((day) => (selectedDayKey ? day.key === selectedDayKey : day.isToday)),
  );
  const start = Math.min(
    Math.max(0, activeIndex - Math.floor(visible / 2)),
    Math.max(0, days.length - visible),
  );
  return {
    windowDays: days.slice(start, start + visible),
    hasPrev: start > 0,
    hasNext: start + visible < days.length,
  };
}

export function calendarDayKeyFromGroup(group: string): string {
  const separatorIdx = group.indexOf(" · ");
  return separatorIdx >= 0 ? group.slice(0, separatorIdx) : group;
}

export function calendarWeekKeyFromIsoDay(isoKey: string): string {
  const date = new Date(`${isoKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoKey;
  const day = date.getDay();
  const mondayOffset = (day + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
}

export function calendarWeekHeaderLabel(weekKey: string, nowMs: number = Date.now()): string {
  const thisWeekKey = calendarWeekKeyFromIsoDay(new Date(nowMs).toISOString().slice(0, 10));
  if (weekKey === thisWeekKey) return "This week";
  const nextWeekDate = new Date(`${thisWeekKey}T00:00:00`);
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);
  if (weekKey === nextWeekDate.toISOString().slice(0, 10)) return "Next week";
  const weekStart = new Date(`${weekKey}T00:00:00`);
  if (Number.isNaN(weekStart.getTime())) return weekKey;
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return `Week of ${formatter.format(weekStart)}`;
}

export function filterCalendarOptionsByDay<T>(
  options: readonly BrowseShellOption<T>[],
  dayKey: string | null,
): readonly BrowseShellOption<T>[] {
  if (dayKey === null) return options;
  return options.filter((option) => {
    const key = option.calendar?.dayKey ?? option.previewDayKey ?? null;
    return key === dayKey;
  });
}

function trackedReleaseMs(option: BrowseShellOption<SearchResult>): number {
  const releaseAt = option.value.calendar?.releaseAt;
  const ms = releaseAt ? Date.parse(releaseAt) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

// For the Tracked tab, a show should appear ONCE — as "what's next" — not once
// per scheduled episode (the timeline view already shows every airing). Prefer
// the soonest UPCOMING airing for a title; if nothing is upcoming, keep the most
// recently aired one.
function preferTrackedOccurrence(
  a: BrowseShellOption<SearchResult>,
  b: BrowseShellOption<SearchResult>,
  nowMs: number,
): BrowseShellOption<SearchResult> {
  const am = trackedReleaseMs(a);
  const bm = trackedReleaseMs(b);
  const aUpcoming = am > nowMs;
  const bUpcoming = bm > nowMs;
  if (aUpcoming && bUpcoming) return am <= bm ? a : b; // soonest upcoming wins
  if (aUpcoming !== bUpcoming) return aUpcoming ? a : b; // upcoming beats aired
  return am >= bm ? a : b; // both aired → most recently aired
}

function dedupeTrackedByTitle(
  options: readonly BrowseShellOption<SearchResult>[],
  nowMs: number,
): readonly BrowseShellOption<SearchResult>[] {
  const byTitle = new Map<string, BrowseShellOption<SearchResult>>();
  for (const option of options) {
    const key = option.value.id || option.label;
    const existing = byTitle.get(key);
    byTitle.set(key, existing ? preferTrackedOccurrence(existing, option, nowMs) : option);
  }
  return [...byTitle.values()];
}

export function filterCalendarOptionsByType(
  options: readonly BrowseShellOption<SearchResult>[],
  tab: CalendarTypeTab,
  nowMs: number = Date.now(),
): readonly BrowseShellOption<SearchResult>[] {
  if (tab === "All") return options;
  if (tab === "Tracked") {
    return dedupeTrackedByTitle(
      options.filter((option) => isCalendarTrackedOption(option)),
      nowMs,
    );
  }
  return options.filter((option) => matchesCalendarType(option.value, tab));
}

function matchesCalendarType(result: SearchResult, tab: CalendarTypeTab): boolean {
  const kind = result.calendar?.contentKind;
  if (tab === "Movies") return kind === "movie";
  if (tab === "Anime") return kind === "anime";
  if (tab === "TV") return kind === "series";
  return true;
}

export function parsePreviewTimeTodayMs(timeLabel: string, nowMs: number): number | null {
  const trimmed = timeLabel.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (minutes > 59) return null;
  if (meridiem && (hours < 1 || hours > 12)) return null;
  if (!meridiem && hours > 23) return null;
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  const date = new Date(nowMs);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

/** Fit broadcast times into the fixed schedule time column. */
export function formatCalendarRowTimeLabel(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "TBD";
  const upper = trimmed.toUpperCase();
  if (upper === "TBD" || upper === "DATE TBA") return "TBD";

  const clock = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    const meridiem = clock[3]?.toUpperCase();
    if (!meridiem) return trimmed;
    if (minute === 0) return `${hour} ${meridiem}`;
    return `${hour}:${String(minute).padStart(2, "0")}${meridiem === "AM" ? "a" : "p"}`;
  }

  const compact = trimmed.match(/^(\d{1,2})\s*(AM|PM)$/i);
  if (compact && compact[2]) return `${compact[1]} ${compact[2].toUpperCase()}`;

  return trimmed.length <= 7 ? trimmed : `${trimmed.slice(0, 6)}…`;
}

export type { CalendarRowLayout } from "./primitives/list-row-layout";
export { computeCalendarRowLayout } from "./primitives/list-row-layout";

/** Shorten long schedule status copy so the right column stays readable. */
export function compactCalendarStatusLabel(label: string, maxColumns: number): string {
  let normalized = label.trim().replace(/^[·✓◷◐×]\s+/, "");
  if (normalized.length <= maxColumns) return normalized;
  if (normalized.startsWith("aired · ")) {
    const tail = normalized.slice("aired · ".length);
    return tail.length <= maxColumns ? tail : truncateLine(tail, maxColumns);
  }
  if (normalized.startsWith("airs today · ")) {
    return "today";
  }
  if (normalized.startsWith("released today · ")) {
    return "today";
  }
  return truncateLine(normalized, maxColumns);
}

export function formatReleaseCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return "soon";
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  if (totalMinutes < 60) return `in ${totalMinutes}m`;

  const minutesPerDay = 24 * 60;
  if (totalMinutes >= minutesPerDay) {
    const days = Math.floor(totalMinutes / minutesPerDay);
    const hours = Math.floor((totalMinutes % minutesPerDay) / 60);
    if (hours === 0) return `in ${days}d`;
    return `in ${days}d ${hours}h`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `in ${hours}h`;
  return `in ${hours}h ${minutes}m`;
}

export function deriveCalendarReleaseState<T>(
  option: BrowseShellOption<T>,
  nowMs: number = Date.now(),
): CalendarReleaseState {
  const item = option.calendar;
  if (!item) return "upcoming";
  if (item.providerConfirmed) return "available";
  if (item.continuation?.playable === true) return "continue-ready";
  if (item.releaseStatus === "unknown") return "upcoming";

  const aired = item.releaseAt ? Date.parse(item.releaseAt) <= nowMs : false;
  if (item.reason === "movie-release" || item.reason === "upcoming-episode") {
    if (item.releasePrecision === "timestamp" && item.releaseAt) {
      return Date.parse(item.releaseAt) > nowMs ? "countdown" : "resolving";
    }
    return "upcoming";
  }
  if (item.reason === "airing-today") {
    if (item.releasePrecision === "timestamp" && item.releaseAt) {
      return Date.parse(item.releaseAt) > nowMs ? "countdown" : "resolving";
    }
    return "resolving";
  }
  return item.dayKey && isSameDayKey(item.dayKey, nowMs)
    ? "resolving"
    : aired
      ? "missed"
      : "upcoming";
}

export function hasProviderConfirmedAvailability<T>(option: BrowseShellOption<T>): boolean {
  return option.calendar?.providerConfirmed === true;
}

/**
 * A release is "new since last visit" when it became available strictly after the
 * last time the calendar was opened and on/before now. `lastVisitAt === 0` (never
 * visited) returns false so the first calendar open is not flooded with dots.
 */
export function isReleaseNew<T>(
  option: BrowseShellOption<T>,
  lastVisitAt: number,
  nowMs: number = Date.now(),
): boolean {
  if (lastVisitAt <= 0) return false;
  const releaseAt = option.calendar?.releaseAt;
  if (!releaseAt) return false;
  const ms = Date.parse(releaseAt);
  if (!Number.isFinite(ms)) return false;
  return ms > lastVisitAt && ms <= nowMs;
}

function isSameDayKey(dayKey: string, nowMs: number): boolean {
  const now = new Date(nowMs);
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return dayKey === key;
}

function formatCalendarReleaseStateLabel<T>(
  state: CalendarReleaseState,
  option: BrowseShellOption<T>,
  nowMs: number = Date.now(),
): string {
  const item = option.calendar;
  if (state === "countdown" && item?.releaseAt) {
    return formatReleaseCountdown(Date.parse(item.releaseAt) - nowMs);
  }
  if (state === "continue-ready") return `continue · ${item?.continuation?.badge ?? "ready"}`;
  if (state === "resolving") return "aired · resolving";
  if (state === "missed") return "aired · not available";
  if (state === "failed") return "schedule unavailable";
  if (item) return item.display.statusLabel;
  return "upcoming";
}

export function calendarReleaseRowPresentation<T>(
  option: BrowseShellOption<T>,
  nowMs: number = Date.now(),
): {
  readonly glyph: string;
  readonly color: string;
  readonly dim: boolean;
  readonly label: string;
} {
  const state = deriveCalendarReleaseState(option, nowMs);
  const label = formatCalendarReleaseStateLabel(state, option, nowMs);
  if (state === "available") {
    return { glyph: "✓ ", color: palette.ok, dim: false, label };
  }
  if (state === "continue-ready") {
    return { glyph: "→ ", color: palette.ok, dim: false, label };
  }
  if (state === "countdown") {
    return { glyph: "◷ ", color: palette.accent, dim: false, label };
  }
  if (state === "resolving") {
    return { glyph: "◐ ", color: palette.dim, dim: true, label };
  }
  if (state === "missed") {
    return { glyph: "· ", color: palette.dangerDim, dim: true, label };
  }
  if (state === "failed") {
    return { glyph: "× ", color: palette.danger, dim: false, label };
  }
  return { glyph: "· ", color: palette.muted, dim: true, label };
}

export function buildCalendarPreviewRailModel(
  option: BrowseShellOption<SearchResult> | undefined,
  posterState: PreviewPosterState,
  nowMs: number = Date.now(),
): PreviewRailModel | null {
  if (!option) return null;
  const state = deriveCalendarReleaseState(option, nowMs);
  const stateLabel = formatCalendarReleaseStateLabel(state, option, nowMs);
  const stateTone =
    state === "available"
      ? ("success" as const)
      : state === "continue-ready"
        ? ("success" as const)
        : state === "countdown"
          ? ("warning" as const)
          : state === "failed"
            ? ("danger" as const)
            : ("muted" as const);
  const tracked = isCalendarTrackedOption(option);
  const trackedValue = option.calendar?.inWatchlist
    ? "on your list"
    : option.calendar?.inHistory
      ? "watch history"
      : "tracked";
  const actionLabel =
    state === "available"
      ? "Enter to open"
      : state === "continue-ready"
        ? "Enter to continue"
        : state === "countdown" || state === "resolving" || state === "missed"
          ? "Enter for details · playback when a source resolves"
          : "Enter for details";

  const normalizedFacts: PreviewRailModel["facts"] = [
    { label: "Schedule", value: stateLabel, tone: stateTone },
    ...(tracked ? [{ label: "Tracked", value: trackedValue, tone: "success" as const }] : []),
    ...(option.previewTime
      ? [{ label: "Airs", value: option.previewTime, tone: "muted" as const }]
      : []),
    {
      label: "Episode",
      value: option.previewBody ?? option.detail ?? "No schedule details",
      tone: "muted" as const,
    },
    { label: "Action", value: actionLabel, tone: "muted" as const },
  ].slice(0, 4);

  return {
    title: option.previewTitle ?? option.label,
    subtitle: [option.previewMeta?.[0], option.previewMeta?.[1]].filter(Boolean).join(" · "),
    overview:
      state === "resolving" || state === "missed"
        ? "This episode has aired on the schedule. Kunai will not offer playback until a provider source is available."
        : state === "continue-ready"
          ? "This release matches your continuation state. Enter uses the same continuation decision as History's Continue tab."
          : option.previewBody,
    posterUrl: option.previewImageUrl,
    posterState,
    facts: normalizedFacts,
  };
}

export function buildCalendarLoadingState(): StateBlockModel {
  return {
    kind: "loading",
    title: "Loading release schedule",
    detail:
      "Fetching this week's airing window from catalog metadata. Provider checks happen only when you open a release.",
  };
}

export function buildCalendarEmptyState(modeLabel: string): StateBlockModel {
  return {
    kind: "empty",
    title: "Nothing on the schedule",
    detail: `No ${modeLabel} releases matched this day and filter. Try another day or open /discover. ${RETURN_LOOP_CALENDAR_EMPTY_TAIL}`,
  };
}

export function buildCalendarErrorState(message: string): StateBlockModel {
  return {
    kind: "error",
    title: "Schedule unavailable",
    detail: message,
    actions: [
      {
        id: "retry-calendar",
        label: "Refresh schedule",
        detail: "Retry catalog metadata without touching providers",
        shortcut: "r",
        tone: "warning",
      },
    ],
  };
}

export function buildCalendarRenderRows<T>(
  options: readonly BrowseShellOption<T>[],
  windowStart: number,
  windowEnd: number,
  nowMs: number = Date.now(),
  selectedDayKey: string | null = null,
  showForYouHeader = false,
  lastVisitAt = 0,
): readonly CalendarRenderRow<T>[] {
  const rows: CalendarRenderRow<T>[] = [];
  let lastDayHeader: string | null = null;
  let lastWeekHeader: string | null = null;
  let forYouHeaderShown = false;

  for (let index = windowStart; index < windowEnd; index += 1) {
    const option = options[index];
    if (!option) continue;
    const presentation = calendarReleaseRowPresentation(option, nowMs);
    const timeLabel = formatCalendarRowTimeLabel(
      option.calendar?.display.time ?? option.previewTime?.trim() ?? null,
    );
    const groupLabel = option.calendar?.display.groupLabel ?? option.previewGroup;
    const dayHeaderLabel =
      selectedDayKey === null && groupLabel ? calendarDayKeyFromGroup(groupLabel) : null;
    // The week marker must be derived from the ISO day key — NOT the display label
    // (e.g. "THU 11"), which `calendarWeekKeyFromIsoDay` cannot parse and would
    // echo back, duplicating the day header. Falls back to null when no ISO key.
    const isoDayKey = option.calendar?.dayKey ?? option.previewDayKey ?? null;
    const weekKey =
      selectedDayKey === null && isoDayKey ? calendarWeekKeyFromIsoDay(isoDayKey) : null;
    const weekChanged = weekKey !== null && weekKey !== lastWeekHeader;
    if (weekChanged) lastWeekHeader = weekKey;
    const showDayHeader = dayHeaderLabel !== null && dayHeaderLabel !== lastDayHeader;
    if (showDayHeader) lastDayHeader = dayHeaderLabel;
    // The week marker rides the day header (no separate band) as a quiet tag.
    // Only future weeks earn a tag — the current week is implied, so it stays
    // unlabelled to avoid "this week" noise next to today's rows.
    const currentWeekKey = calendarWeekKeyFromIsoDay(new Date(nowMs).toISOString().slice(0, 10));
    const weekTag =
      showDayHeader && weekChanged && weekKey && weekKey !== currentWeekKey
        ? calendarWeekHeaderLabel(weekKey, nowMs).toLowerCase()
        : null;

    const badge = option.previewBadge;
    const episodeCode =
      option.calendar?.display.episodeCode || (badge && badge !== "wl" ? badge : "");

    const showForYouHeaderOnce = showForYouHeader && !forYouHeaderShown;
    if (showForYouHeaderOnce) forYouHeaderShown = true;

    rows.push({
      option,
      optionIndex: index,
      timeLabel,
      episodeCode,
      statusLabel: presentation.label,
      statusColor: presentation.color,
      statusDim: presentation.dim,
      statusGlyph: presentation.glyph.trim(),
      weekTag,
      showDayHeader,
      dayHeaderLabel: showDayHeader ? dayHeaderLabel : null,
      showForYouHeaderOnce,
      isNew: isReleaseNew(option, lastVisitAt, nowMs),
      tracked: isCalendarTrackedOption(option),
      posterUrl: option.previewImageUrl ?? option.calendar?.poster ?? undefined,
    });
  }

  return rows;
}

/** Rendered line cost of a calendar row: the row itself + any headers it carries.
 *  A header is a SectionGroup = 1 margin line + 1 label line = 2 extra lines. */
export function calendarRowLineCost<T>(row: CalendarRenderRow<T>): number {
  let lines = 1;
  if (row.showForYouHeaderOnce) lines += 2;
  if (row.showDayHeader) lines += 2;
  return lines;
}

/** Pick a contiguous slice of pre-built render rows that fits `maxLines` of
 *  rendered height while keeping `selectedIndex` visible. Grows downward first
 *  (natural reading order), then upward to use any remaining budget. */
export function windowCalendarRowsByLines<T>(
  rows: readonly CalendarRenderRow<T>[],
  selectedIndex: number,
  maxLines: number,
): { readonly start: number; readonly end: number } {
  const budget = Math.max(1, maxLines);
  const anchor = Math.min(Math.max(0, selectedIndex), rows.length - 1);
  const anchorRow = rows[anchor];
  if (!anchorRow) return { start: 0, end: 0 };

  let used = calendarRowLineCost(anchorRow);
  let start = anchor;
  let end = anchor + 1; // exclusive

  // Grow downward.
  while (end < rows.length) {
    const row = rows[end];
    if (!row) break;
    const next = used + calendarRowLineCost(row);
    if (next > budget) break;
    used = next;
    end += 1;
  }
  // Grow upward with whatever budget remains.
  while (start > 0) {
    const row = rows[start - 1];
    if (!row) break;
    const next = used + calendarRowLineCost(row);
    if (next > budget) break;
    used = next;
    start -= 1;
  }
  return { start, end };
}
