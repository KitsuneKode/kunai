import type { Container } from "@/container";
import type { SearchResult } from "@/domain/types";
import type {
  CatalogScheduleItem,
  CatalogScheduleMode,
} from "@/services/catalog/CatalogScheduleService";
import type { HistoryEntry, HistoryStore } from "@/services/persistence/HistoryStore";
import type { ReleaseProgressCacheRepository, ReleaseProgressProjection } from "@kunai/storage";

export type CalendarResultBundle = {
  readonly results: readonly SearchResult[];
  readonly subtitle: string;
  readonly emptyMessage: string;
};

type CalendarContainer = Pick<Container, "stateManager" | "timelineService" | "listService"> & {
  readonly historyStore?: Pick<HistoryStore, "getAll">;
  readonly releaseProgressCache?: Pick<ReleaseProgressCacheRepository, "getByTitleIds" | "upsert">;
};

export async function loadCalendarResults(
  container: CalendarContainer,
  signal?: AbortSignal,
): Promise<CalendarResultBundle> {
  const mode = container.stateManager.getState().mode;
  const days = 7;
  const items = await loadCalendarWindow(container.timelineService, mode, days, signal);
  const sorted = [...items].sort(compareCalendarItems);
  const isInWatchlist = (titleId: string) => container.listService.isInWatchlist(titleId);
  let historyMatches = new Map<
    string,
    { readonly titleId: string; readonly entry: HistoryEntry }
  >();
  if (container.historyStore) {
    historyMatches = matchCalendarHistory(sorted, await container.historyStore.getAll());
  }
  const projectionIds = [
    ...new Set([
      ...sorted.map((item) => item.titleId),
      ...[...historyMatches.values()].map((match) => match.titleId),
    ]),
  ];
  const storedProgress = container.releaseProgressCache?.getByTitleIds(projectionIds) ?? new Map();
  let releaseProgress = projectProgressForCalendarItems(sorted, historyMatches, storedProgress);
  if (container.releaseProgressCache?.upsert && container.historyStore) {
    for (const item of sorted) {
      const match = historyMatches.get(item.titleId);
      const entry = match?.entry;
      if (!entry || item.status !== "released" || typeof item.episode !== "number") continue;
      if (entry.type !== "series" || item.episode <= entry.episode) continue;
      if (
        item.source === "tmdb" &&
        typeof item.season === "number" &&
        item.season !== entry.season
      ) {
        continue;
      }
      const existing = releaseProgress.get(item.titleId);
      if (existing && existing.latestAiredEpisode && existing.latestAiredEpisode >= item.episode) {
        continue;
      }
      const now = new Date().toISOString();
      const projection: ReleaseProgressProjection = {
        titleId: match.titleId,
        mediaKind: entry.mediaKind ?? (item.type === "anime" ? "anime" : "series"),
        source: item.source,
        title: entry.title,
        anchorSeason: entry.season,
        anchorEpisode: entry.episode,
        latestAiredSeason: item.season ?? entry.season,
        latestAiredEpisode: item.episode,
        newEpisodeCount: Math.max(0, item.episode - entry.episode),
        status: "new-episodes",
        checkedAt: now,
        nextCheckAt: now,
        staleAfterAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        latestKnownReleaseAt: item.releaseAt ?? undefined,
        sourceFingerprint: `calendar:${item.source}:${item.titleId}:${item.episode}:${item.releaseAt ?? "-"}`,
        errorCount: 0,
      };
      container.releaseProgressCache.upsert(projection);
      releaseProgress = new Map(releaseProgress).set(item.titleId, projection);
    }
  }
  const results = sorted.map((item) =>
    toCalendarSearchResult(item, isInWatchlist, releaseProgress.get(item.titleId)),
  );
  const releasedCount = sorted.filter((item) => item.status === "released").length;
  const airingTodayCount = sorted.filter(
    (item) => item.status !== "released" && isSameLocalDay(item.releaseAt, Date.now()),
  ).length;
  const newEpisodeCount = [...releaseProgress.values()].reduce(
    (total, projection) => total + activeNewEpisodeCount(projection),
    0,
  );
  const newEpisodeSuffix = newEpisodeCount > 0 ? ` · ${newEpisodeCount} new for you` : "";

  return {
    results,
    subtitle:
      results.length > 0
        ? `${results.length} this week · ${airingTodayCount} airing today · ${releasedCount} released · ${mode} schedule${newEpisodeSuffix}`
        : `No ${mode} releases found for the next week`,
    emptyMessage: `No ${mode} releases found for the next week. Search and recommendations still work normally.`,
  };
}

function matchCalendarHistory(
  items: readonly CatalogScheduleItem[],
  entries: Record<string, HistoryEntry>,
): Map<string, { readonly titleId: string; readonly entry: HistoryEntry }> {
  const matches = new Map<string, { readonly titleId: string; readonly entry: HistoryEntry }>();
  const indexedEntries = Object.entries(entries);
  for (const item of items) {
    const direct = entries[item.titleId];
    if (direct) {
      matches.set(item.titleId, { titleId: item.titleId, entry: direct });
      continue;
    }
    const rawId = item.titleId.startsWith(`${item.source}:`)
      ? item.titleId.slice(item.source.length + 1)
      : item.titleId;
    const match = indexedEntries.find(([, entry]) =>
      item.source === "anilist"
        ? entry.externalIds?.anilistId === rawId
        : entry.externalIds?.tmdbId === rawId,
    );
    if (match) matches.set(item.titleId, { titleId: match[0], entry: match[1] });
  }
  return matches;
}

function projectProgressForCalendarItems(
  items: readonly CatalogScheduleItem[],
  matches: ReadonlyMap<string, { readonly titleId: string }>,
  storedProgress: ReadonlyMap<string, ReleaseProgressProjection>,
): Map<string, ReleaseProgressProjection> {
  const projected = new Map<string, ReleaseProgressProjection>();
  for (const item of items) {
    const progress = storedProgress.get(matches.get(item.titleId)?.titleId ?? item.titleId);
    if (progress) projected.set(item.titleId, progress);
  }
  return projected;
}

function toCalendarSearchResult(
  item: CatalogScheduleItem,
  isInWatchlist?: (titleId: string) => boolean,
  releaseProgress?: ReleaseProgressProjection,
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
    displayBadge:
      activeNewEpisodeCount(releaseProgress) > 0
        ? `${activeNewEpisodeCount(releaseProgress)} new`
        : isInWatchlist?.(item.titleId)
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

function activeNewEpisodeCount(projection: ReleaseProgressProjection | undefined): number {
  if (!projection || projection.status !== "new-episodes") return 0;
  const staleAfterMs = Date.parse(projection.staleAfterAt);
  if (Number.isFinite(staleAfterMs) && staleAfterMs <= Date.now()) return 0;
  return Math.max(0, Math.trunc(projection.newEpisodeCount));
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
