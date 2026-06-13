import type { Container } from "@/container";
import { buildCalendarItem, type CalendarItem } from "@/domain/calendar/calendar-item";
import type { SearchResult } from "@/domain/types";
import type {
  CatalogScheduleItem,
  CatalogScheduleMode,
} from "@/services/catalog/CatalogScheduleService";
import { historyContentType } from "@/services/continuation/history-progress";
import type { HistoryStore } from "@/services/persistence/HistoryStore";
import type {
  CalendarArchiveRepository,
  HistoryProgress,
  ReleaseProgressCacheRepository,
  ReleaseProgressProjection,
} from "@kunai/storage";

/** How many days of past schedule to retain + surface alongside the upcoming window. */
const CALENDAR_PAST_WINDOW_DAYS = 7;

export type CalendarResultBundle = {
  readonly results: readonly SearchResult[];
  readonly subtitle: string;
  readonly emptyMessage: string;
};

type CalendarContainer = Pick<Container, "stateManager" | "timelineService" | "listService"> & {
  readonly historyStore?: Pick<HistoryStore, "getAll">;
  readonly releaseProgressCache?: Pick<ReleaseProgressCacheRepository, "getByTitleIds" | "upsert">;
  readonly calendarArchive?: Pick<
    CalendarArchiveRepository,
    "archive" | "listInWindow" | "pruneBefore"
  >;
};

export async function loadCalendarResults(
  container: CalendarContainer,
  signal?: AbortSignal,
): Promise<CalendarResultBundle> {
  const days = 7;
  const forwardItems = await loadUnifiedCalendarWindow(container.timelineService, days, signal);
  const items = mergeArchivedPastWindow(container, forwardItems);
  const sorted = [...items].sort(compareCalendarItems);
  const isInWatchlist = (titleId: string) => container.listService.isInWatchlist(titleId);
  let historyMatches = new Map<
    string,
    { readonly titleId: string; readonly entry: HistoryProgress }
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
      const entrySeason = entry.season ?? 1;
      const entryEpisode = entry.episode ?? entry.absoluteEpisode ?? 1;
      if (historyContentType(entry) !== "series" || item.episode <= entryEpisode) continue;
      if (
        item.source === "tmdb" &&
        typeof item.season === "number" &&
        item.season !== entrySeason
      ) {
        continue;
      }
      const existing = releaseProgress.get(item.titleId);
      if (existing && existing.latestAiredEpisode && existing.latestAiredEpisode >= item.episode) {
        continue;
      }
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      const projection: ReleaseProgressProjection = {
        titleId: match.titleId,
        mediaKind: entry.mediaKind ?? (item.type === "anime" ? "anime" : "series"),
        source: item.source,
        title: entry.title,
        anchorSeason: entrySeason,
        anchorEpisode: entryEpisode,
        latestAiredSeason: item.season ?? entrySeason,
        latestAiredEpisode: item.episode,
        newEpisodeCount: Math.max(0, item.episode - entryEpisode),
        status: "new-episodes",
        checkedAt: now,
        // The calendar provides a fast optimistic "+N new" badge, but must NOT force
        // immediate re-reconciliation (nextCheckAt=now defeats the planner's not-due
        // skip and re-fetches this title every cycle — the calendar/reconciliation
        // writer race). Schedule the next check on a normal cadence instead.
        nextCheckAt: new Date(nowMs + 2 * 60 * 60 * 1000).toISOString(),
        staleAfterAt: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
        latestKnownReleaseAt: item.releaseAt ?? undefined,
        sourceFingerprint: `calendar:${item.source}:${item.titleId}:${item.episode}:${item.releaseAt ?? "-"}`,
        errorCount: 0,
      };
      container.releaseProgressCache.upsert(projection);
      releaseProgress = new Map(releaseProgress).set(item.titleId, projection);
    }
  }
  const results = sorted.map((item) => {
    const progress = releaseProgress.get(item.titleId);
    const calendar = buildCalendarItem(item, {
      nowMs: Date.now(),
      inWatchlist: isInWatchlist(item.titleId),
      inHistory: historyMatches.has(item.titleId),
      newEpisodeCount: activeNewEpisodeCount(progress),
      providerConfirmed: false,
    });
    return toCalendarSearchResult(item, calendar);
  });
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
        ? `${results.length} this week · ${airingTodayCount} airing today · ${releasedCount} released${newEpisodeSuffix}`
        : "No releases found for the next week",
    emptyMessage:
      "No releases found for the next week. Search and recommendations still work normally.",
  };
}

function matchCalendarHistory(
  items: readonly CatalogScheduleItem[],
  entries: Record<string, HistoryProgress>,
): Map<string, { readonly titleId: string; readonly entry: HistoryProgress }> {
  const matches = new Map<string, { readonly titleId: string; readonly entry: HistoryProgress }>();
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

function toCalendarSearchResult(item: CatalogScheduleItem, calendar: CalendarItem): SearchResult {
  const year = item.releaseAt ? String(new Date(item.releaseAt).getFullYear()) : "";
  const rawTitleId = item.titleId.startsWith(`${item.source}:`)
    ? item.titleId.slice(item.source.length + 1)
    : item.titleId;
  return {
    id: item.titleId,
    type: item.type === "movie" ? "movie" : "series",
    ...(item.type === "anime" ? { isAnime: true } : {}),
    externalIds:
      item.source === "anilist"
        ? { anilistId: rawTitleId }
        : item.source === "tmdb"
          ? { tmdbId: rawTitleId }
          : undefined,
    title: item.titleName,
    year,
    overview: calendar.display.episodeCode
      ? `${calendar.display.episodeCode} · ${calendar.display.statusLabel}`
      : calendar.display.statusLabel,
    posterPath: item.posterPath ?? null,
    metadataSource: `${item.source === "anilist" ? "AniList" : "TMDB"} calendar`,
    rating: typeof item.averageScore === "number" ? item.averageScore / 10 : undefined,
    popularity: item.popularity,
    calendar,
    episodeCount: item.episode,
  };
}

function activeNewEpisodeCount(projection: ReleaseProgressProjection | undefined): number {
  if (!projection || projection.status !== "new-episodes") return 0;
  const staleAfterMs = Date.parse(projection.staleAfterAt);
  if (Number.isFinite(staleAfterMs) && staleAfterMs <= Date.now()) return 0;
  return Math.max(0, Math.trunc(projection.newEpisodeCount));
}

/**
 * Combine the freshly-fetched upcoming window with a rolling archive of the past
 * ~7 days. The release sources only return upcoming items, so we persist each
 * forward item keyed by (titleId, releaseAt); once its date passes it reappears
 * here as "past week" schedule. Pruned to the retention window on every load so
 * the archive cannot grow unbounded. Falls back to forward-only if no archive.
 */
function mergeArchivedPastWindow(
  container: CalendarContainer,
  forwardItems: readonly CatalogScheduleItem[],
  nowMs: number = Date.now(),
): readonly CatalogScheduleItem[] {
  const archive = container.calendarArchive;
  if (!archive) return forwardItems;

  const windowStartIso = new Date(
    nowMs - CALENDAR_PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  archive.archive(
    forwardItems.flatMap((item) =>
      item.releaseAt
        ? [
            {
              titleId: item.titleId,
              releaseAt: item.releaseAt,
              mode: item.type,
              payloadJson: JSON.stringify(item),
            },
          ]
        : [],
    ),
  );

  const pastItems = archive.listInWindow(windowStartIso, nowIso).flatMap((payload) => {
    const parsed = parseArchivedCalendarItem(payload);
    return parsed ? [parsed] : [];
  });

  // Incidental cleanup — drop anything older than the retention window.
  archive.pruneBefore(windowStartIso);

  // Dedupe by title + release; the fresh forward copy wins over an archived one.
  const merged = new Map<string, CatalogScheduleItem>();
  for (const item of pastItems) merged.set(`${item.titleId}|${item.releaseAt ?? ""}`, item);
  for (const item of forwardItems) merged.set(`${item.titleId}|${item.releaseAt ?? ""}`, item);

  // Clamp the visible window to [now-7d, now+7d]. The forward sources can return
  // stray recently-aired items a little outside the upcoming window (e.g. one that
  // aired 8 days ago), which otherwise show as a lone, gappy past-day chip. Items
  // with no concrete releaseAt (TBD) are always kept.
  const windowStartMs = nowMs - CALENDAR_PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const windowEndMs = nowMs + (CALENDAR_PAST_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000;
  return [...merged.values()].filter((item) => {
    if (!item.releaseAt) return true;
    const ms = Date.parse(item.releaseAt);
    return !Number.isFinite(ms) || (ms >= windowStartMs && ms <= windowEndMs);
  });
}

function parseArchivedCalendarItem(payloadJson: string): CatalogScheduleItem | null {
  try {
    return JSON.parse(payloadJson) as CatalogScheduleItem;
  } catch {
    return null;
  }
}

async function loadUnifiedCalendarWindow(
  timelineService: CalendarContainer["timelineService"],
  days: number,
  signal?: AbortSignal,
): Promise<readonly CatalogScheduleItem[]> {
  // Content-kind aware: load anime + series + movie windows concurrently and merge.
  // allSettled keeps the calendar rendering even if one source fails.
  const tasks: Promise<readonly CatalogScheduleItem[]>[] = [
    loadWindowForMode(timelineService, "anime", days, signal),
    loadWindowForMode(timelineService, "series", days, signal),
    "loadMovieReleaseWindow" in timelineService &&
    typeof timelineService.loadMovieReleaseWindow === "function"
      ? timelineService.loadMovieReleaseWindow(days, signal)
      : Promise.resolve<readonly CatalogScheduleItem[]>([]),
  ];
  const settled = await Promise.allSettled(tasks);
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function loadWindowForMode(
  timelineService: CalendarContainer["timelineService"],
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
  return result.calendar !== undefined;
}
