import type { BrowseLocalFilterFacts } from "@/app-shell/types";
import type { CalendarItem } from "@/domain/calendar/calendar-item";
import type { ReleaseFilter, WatchFilter } from "@/domain/search/SearchIntent";
import type { SearchResult } from "@/domain/types";
import type { ResultEnrichmentBadge } from "@/services/catalog/ResultEnrichmentService";
import { isFinished } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@kunai/storage";

export type BuildLocalFilterFactsInput = {
  readonly result: Pick<SearchResult, "type" | "release" | "contentShape" | "isAnime">;
  readonly historyEntry?: HistoryProgress | null;
  readonly enrichmentBadges?: readonly ResultEnrichmentBadge[];
  readonly calendar?: CalendarItem;
  readonly nowMs?: number;
};

export type BrowseLibraryFilterAvailability = {
  readonly watched: boolean;
  readonly downloaded: boolean;
  readonly release: boolean;
};

export function browseLibraryFilterAvailability(input: {
  readonly downloadsEnabled: boolean;
  /** Release facets need calendar/release browse context, not just non-YouTube mode. */
  readonly calendarReleaseContext?: boolean;
}): BrowseLibraryFilterAvailability {
  return {
    watched: true,
    downloaded: input.downloadsEnabled,
    release: input.calendarReleaseContext === true,
  };
}

export function buildLocalFilterFacts(input: BuildLocalFilterFactsInput): BrowseLocalFilterFacts {
  const mediaType =
    input.result.type === "movie" || input.result.type === "series" ? input.result.type : undefined;

  return {
    ...(mediaType ? { mediaType } : {}),
    ...(input.result.contentShape ? { contentShape: input.result.contentShape } : {}),
    ...(input.result.isAnime === true ? { isAnime: true } : {}),
    ...deriveDownloadedFact(input.enrichmentBadges),
    ...deriveWatchedFact(input.historyEntry),
    ...deriveReleaseFact(input),
  };
}

function deriveDownloadedFact(
  badges?: readonly ResultEnrichmentBadge[],
): Pick<BrowseLocalFilterFacts, "downloaded"> {
  if (badges === undefined) return {};
  const downloaded = badges.some(
    (badge) => badge.label === "downloaded" || badge.label.startsWith("↓"),
  );
  return { downloaded };
}

function deriveWatchedFact(
  historyEntry?: HistoryProgress | null,
): Pick<BrowseLocalFilterFacts, "watched"> {
  if (!historyEntry) return { watched: "unwatched" };
  if (isFinished(historyEntry)) return { watched: "completed" };
  return { watched: "watching" };
}

function deriveReleaseFact(
  input: BuildLocalFilterFactsInput,
): Pick<BrowseLocalFilterFacts, "release"> {
  const release = input.calendar
    ? deriveCalendarReleaseFilter(input.calendar, input.nowMs ?? Date.now())
    : deriveProviderReleaseFilter(input.result.release, input.nowMs ?? Date.now());
  return release ? { release } : {};
}

function deriveCalendarReleaseFilter(
  calendar: CalendarItem,
  nowMs: number,
): ReleaseFilter | undefined {
  if (!calendar.releaseAt || calendar.releaseStatus === "unknown") return undefined;
  if (calendar.reason === "airing-today" || isSameLocalDay(calendar.releaseAt, nowMs)) {
    return "today";
  }
  if (calendar.releaseStatus === "upcoming") {
    if (isWithinNextWeek(calendar.releaseAt, nowMs)) return "this-week";
    return "upcoming";
  }
  return undefined;
}

function deriveProviderReleaseFilter(
  release: SearchResult["release"],
  nowMs: number,
): ReleaseFilter | undefined {
  if (!release?.availableAt && !release?.airDate) return undefined;
  const releaseAt = release.availableAt ?? release.airDate;
  if (!releaseAt) return undefined;
  if (release.status === "upcoming") {
    if (isSameLocalDay(releaseAt, nowMs)) return "today";
    if (isWithinNextWeek(releaseAt, nowMs)) return "this-week";
    return "upcoming";
  }
  if (release.status === "released" && isSameLocalDay(releaseAt, nowMs)) {
    return "today";
  }
  return undefined;
}

function isSameLocalDay(releaseAt: string, nowMs: number): boolean {
  const release = new Date(releaseAt);
  if (Number.isNaN(release.getTime())) return false;
  const now = new Date(nowMs);
  return (
    release.getFullYear() === now.getFullYear() &&
    release.getMonth() === now.getMonth() &&
    release.getDate() === now.getDate()
  );
}

function isWithinNextWeek(releaseAt: string, nowMs: number): boolean {
  const release = new Date(releaseAt);
  if (Number.isNaN(release.getTime())) return false;
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  return release >= startOfToday && release < endOfWeek;
}

export function matchesLibraryWatchedFilter(
  facts: BrowseLocalFilterFacts | undefined,
  watched: WatchFilter,
): boolean {
  if (watched === "any") return true;
  return facts?.watched === watched;
}

export function matchesLibraryDownloadedFilter(
  facts: BrowseLocalFilterFacts | undefined,
  downloaded: boolean,
): boolean {
  return facts?.downloaded === downloaded;
}

export function matchesLibraryReleaseFilter(
  facts: BrowseLocalFilterFacts | undefined,
  release: ReleaseFilter,
): boolean {
  return facts?.release === release;
}
