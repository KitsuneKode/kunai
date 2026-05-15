import type { Container } from "@/container";
import type { SearchResult } from "@/domain/types";
import type {
  CatalogScheduleItem,
  CatalogScheduleMode,
} from "@/services/catalog/CatalogScheduleService";

export type CalendarResultBundle = {
  readonly results: readonly SearchResult[];
  readonly subtitle: string;
  readonly emptyMessage: string;
};

export async function loadCalendarResults(
  container: Pick<Container, "stateManager" | "timelineService">,
  signal?: AbortSignal,
): Promise<CalendarResultBundle> {
  const mode = container.stateManager.getState().mode;
  const days = mode === "anime" ? 7 : 1;
  const items = await loadCalendarWindow(container.timelineService, mode, days, signal);
  const sorted = [...items].sort(compareCalendarItems);
  const results = sorted.map((item) => toCalendarSearchResult(item));
  const releasedCount = sorted.filter((item) => item.status === "released").length;
  const upcomingCount = sorted.filter((item) => item.status !== "released").length;
  const todayCount = sorted.filter((item) => isSameLocalDay(item.releaseAt, Date.now())).length;

  return {
    results,
    subtitle:
      results.length > 0
        ? mode === "anime"
          ? `${results.length} this week · ${todayCount} today · ${releasedCount} released · anime schedule`
          : `${upcomingCount} airing today · ${releasedCount} released · series schedule`
        : `No ${mode === "anime" ? "anime releases found for the next week" : "series releases found for today"}`,
    emptyMessage:
      mode === "anime"
        ? "No anime releases found for the next week. Search and recommendations still work normally."
        : "No TV releases found for today. Search and recommendations still work normally.",
  };
}

function toCalendarSearchResult(item: CatalogScheduleItem): SearchResult {
  const releaseLabel = describeCalendarRelease(item);
  const source = item.source === "anilist" ? "AniList" : "TMDB";
  const year = item.releaseAt ? String(new Date(item.releaseAt).getFullYear()) : "";
  const dayLabel = describeCalendarDay(item.releaseAt);
  const badgeLabel = describeCalendarBadge(item, dayLabel);
  const episodeLabel =
    typeof item.episode === "number"
      ? `${formatCalendarEpisodeCode(item)}${item.episodeTitle ? ` · ${item.episodeTitle}` : ""}`
      : "Scheduled release";

  return {
    id: item.titleId,
    type: item.type === "movie" ? "movie" : "series",
    title: item.titleName,
    year,
    overview: `${dayLabel}. ${episodeLabel}. ${releaseLabel}. Availability is checked only when you choose playback.`,
    posterPath: item.posterPath ?? null,
    metadataSource: `${source} calendar · ${dayLabel} · ${badgeLabel} · ${item.releasePrecision}`,
    rating: typeof item.averageScore === "number" ? item.averageScore / 10 : undefined,
    popularity: item.popularity,
    episodeCount: item.episode,
  };
}

async function loadCalendarWindow(
  timelineService: Pick<Container, "timelineService">["timelineService"],
  mode: CatalogScheduleMode,
  days: number,
  signal?: AbortSignal,
): Promise<readonly CatalogScheduleItem[]> {
  if (
    "loadReleaseWindow" in timelineService &&
    typeof timelineService.loadReleaseWindow === "function"
  ) {
    return timelineService.loadReleaseWindow(mode, days, signal);
  }
  return timelineService.loadReleasingToday(mode, signal);
}

function describeCalendarRelease(item: CatalogScheduleItem): string {
  const dayLabel = describeCalendarDay(item.releaseAt);
  if (!item.releaseAt || item.releasePrecision === "unknown") {
    return item.status === "released"
      ? `available ${formatReleaseDayPhrase(dayLabel)}`
      : `scheduled ${formatReleaseDayPhrase(dayLabel)}`;
  }

  if (item.releasePrecision === "timestamp") {
    const release = new Date(item.releaseAt);
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(release);
    const dayPhrase = formatReleaseDayPhrase(dayLabel);
    return item.status === "released"
      ? `released ${dayPhrase} at ${time}`
      : `airs ${dayPhrase} at ${time}`;
  }

  const dayPhrase = formatReleaseDayPhrase(dayLabel);
  return item.status === "released" ? `available ${dayPhrase}` : `scheduled for ${dayPhrase}`;
}

function describeCalendarBadge(item: CatalogScheduleItem, dayLabel: string): string {
  const dayPhrase = formatReleaseDayPhrase(dayLabel);
  if (item.status === "released")
    return dayPhrase === "today" ? "new today" : `released ${dayPhrase}`;
  return dayPhrase === "today" ? "airs today" : `airs ${dayPhrase}`;
}

function describeCalendarDay(releaseAt: string | null): string {
  if (!releaseAt) return "Date unknown";
  const release = new Date(releaseAt);
  const now = new Date();
  if (isSameLocalDay(releaseAt, now.getTime())) return "Today";
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameLocalDay(releaseAt, tomorrow.getTime())) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(release);
}

function formatReleaseDayPhrase(dayLabel: string): string {
  if (dayLabel === "Date unknown") return "when the date is known";
  if (dayLabel === "Today") return "today";
  if (dayLabel === "Tomorrow") return "tomorrow";
  return dayLabel;
}

function formatCalendarEpisodeCode(item: CatalogScheduleItem): string {
  if (typeof item.season === "number" && typeof item.episode === "number") {
    return `S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`;
  }
  if (typeof item.episode === "number") return `Episode ${item.episode}`;
  return "Scheduled release";
}

function compareCalendarItems(left: CatalogScheduleItem, right: CatalogScheduleItem): number {
  const leftTime = left.releaseAt ? Date.parse(left.releaseAt) : Number.MAX_SAFE_INTEGER;
  const rightTime = right.releaseAt ? Date.parse(right.releaseAt) : Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const popularityDelta = (right.popularity ?? 0) - (left.popularity ?? 0);
  if (popularityDelta !== 0) return popularityDelta;
  return left.titleName.localeCompare(right.titleName);
}

function isSameLocalDay(releaseAt: string | null, nowMs: number): boolean {
  if (!releaseAt) return false;
  const release = new Date(releaseAt);
  const now = new Date(nowMs);
  return (
    release.getFullYear() === now.getFullYear() &&
    release.getMonth() === now.getMonth() &&
    release.getDate() === now.getDate()
  );
}
