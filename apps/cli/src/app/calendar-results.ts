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
  container: Pick<Container, "stateManager" | "timelineService" | "listService">,
  signal?: AbortSignal,
): Promise<CalendarResultBundle> {
  const mode = container.stateManager.getState().mode;
  const days = 7;
  const items = await loadCalendarWindow(container.timelineService, mode, days, signal);
  const sorted = [...items].sort(compareCalendarItems);
  const isInWatchlist = (titleId: string) => container.listService.isInWatchlist(titleId);
  const results = sorted.map((item) => toCalendarSearchResult(item, isInWatchlist));
  const releasedCount = sorted.filter((item) => item.status === "released").length;
  const airingTodayCount = sorted.filter(
    (item) => item.status !== "released" && isSameLocalDay(item.releaseAt, Date.now()),
  ).length;

  return {
    results,
    subtitle:
      results.length > 0
        ? `${results.length} this week · ${airingTodayCount} airing today · ${releasedCount} released · ${mode} schedule`
        : `No ${mode} releases found for the next week`,
    emptyMessage: `No ${mode} releases found for the next week. Search and recommendations still work normally.`,
  };
}

function toCalendarSearchResult(
  item: CatalogScheduleItem,
  isInWatchlist?: (titleId: string) => boolean,
): SearchResult {
  const releaseLabel = describeCalendarRelease(item);
  const source = item.source === "anilist" ? "AniList" : "TMDB";
  const year = item.releaseAt ? String(new Date(item.releaseAt).getFullYear()) : "";
  const dayLabel = describeCalendarDay(item.releaseAt);
  const groupLabel = describeCalendarGroup(item.releaseAt);
  const timeLabel = describeCalendarTime(item);
  const badgeLabel = describeCalendarBadge(item, dayLabel);
  const episodeLine = formatCalendarEpisodeLine(item);

  return {
    id: item.titleId,
    type: item.type === "movie" ? "movie" : "series",
    title: item.titleName,
    year,
    overview: episodeLine ? `${episodeLine} · ${releaseLabel}` : `${releaseLabel}`,
    posterPath: item.posterPath ?? null,
    metadataSource: `${source} calendar · ${dayLabel} · ${badgeLabel} · ${item.releasePrecision}`,
    rating: typeof item.averageScore === "number" ? item.averageScore / 10 : undefined,
    popularity: item.popularity,
    displayGroup: groupLabel,
    displayTime: timeLabel,
    displayBadge: isInWatchlist?.(item.titleId)
      ? "wl"
      : typeof item.episode === "number"
        ? `E${item.episode}`
        : undefined,
    displayReleaseStatus:
      item.status === "released"
        ? "released"
        : isSameLocalDay(item.releaseAt, Date.now())
          ? "airing-today"
          : "upcoming",
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

function describeCalendarGroup(releaseAt: string | null): string {
  if (!releaseAt) return "DATE TBA";
  const release = new Date(releaseAt);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" })
    .format(release)
    .toUpperCase();
  const day = new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(release);
  const relative = describeCalendarDay(releaseAt);
  const base = `${weekday} ${day}`;
  return relative === "Today" || relative === "Tomorrow" ? `${base} · ${relative}` : base;
}

function describeCalendarTime(item: CatalogScheduleItem): string | undefined {
  if (!item.releaseAt || item.releasePrecision !== "timestamp") return undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(item.releaseAt));
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
  if (typeof item.episode === "number") return `E${String(item.episode).padStart(2, "0")}`;
  return "";
}

function formatCalendarEpisodeLine(item: CatalogScheduleItem): string {
  const code = formatCalendarEpisodeCode(item);
  if (!code && !item.episodeTitle) return "";
  if (item.episodeTitle?.trim()) {
    return code ? `${code} · ${item.episodeTitle.trim()}` : item.episodeTitle.trim();
  }
  return code;
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

export function isCalendarSearchResult(result: SearchResult): boolean {
  return result.metadataSource?.includes(" calendar · ") ?? false;
}
