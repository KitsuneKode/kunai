import type { BrowseIdleContext } from "@/app-shell/types";
import type { Container } from "@/container";
import { ENGAGE_SECONDS } from "@/domain/playback/progress-engage-policy";
import { shellModeToProviderLane } from "@/domain/provider-lane";
import type { ShellMode } from "@/domain/types";
import {
  historyContentType,
  historyEpisodeLabel,
  historyProviderLane,
  isYoutubeHistoryEntry,
  readLatestHistoryByTitle,
} from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@/services/storage/storage-read-models";
import { applyYoutubeHistoryEnrichment } from "@/services/youtube/youtube-history-metadata";

type IdleContextContainer = Pick<
  Container,
  | "queueService"
  | "releaseProgressCache"
  | "offlineAssetService"
  | "historyRepository"
  | "listService"
  | "followedTitleRepository"
  | "config"
>;

export async function buildBrowseIdleContext(
  container: IdleContextContainer,
  options?: {
    readonly preloadedHistory?: Record<string, HistoryProgress>;
    readonly mode?: ShellMode;
  },
): Promise<{
  readonly idleContext: BrowseIdleContext | undefined;
  readonly continueWatchingSelection: ContinueWatchingSelection | null;
}> {
  const mode = options?.mode;
  const lane = mode ? shellModeToProviderLane(mode) : undefined;
  const matchesStoredMode = (row: {
    readonly mediaKind: string;
    readonly externalIds?: HistoryProgress["externalIds"];
  }) => {
    if (!lane) return true;
    const rowLane =
      row.mediaKind === "video" || row.externalIds?.youtubeId
        ? "youtube"
        : row.mediaKind === "anime" || row.externalIds?.anilistId || row.externalIds?.malId
          ? "anime"
          : "series";
    return rowLane === lane;
  };
  // The queue remains global and ordered. Never display a later matching item:
  // the action consumes the actual head, so a foreign-mode head is simply hidden.
  const queuedNextItem = container.queueService.peekNext();
  const playlistNextItem =
    queuedNextItem && matchesStoredMode(queuedNextItem) ? queuedNextItem : undefined;
  const releaseSummary = container.releaseProgressCache.summarizeActive();

  let continueWatching: BrowseIdleContext["continueWatching"];
  let continueWatchingSelection: ContinueWatchingSelection | null = null;
  let offlineReadyNext: BrowseIdleContext["offlineReadyNext"];
  let savedNext: BrowseIdleContext["savedNext"];
  let calendarNudge: BrowseIdleContext["calendarNudge"];
  let newSinceVisit: BrowseIdleContext["newSinceVisit"];

  try {
    const allHistory =
      options?.preloadedHistory ?? readLatestHistoryByTitle(container.historyRepository);
    const entries = Object.entries(allHistory).filter(
      ([, entry]) => !lane || historyProviderLane(entry) === lane,
    );
    const sortedByRecency = [...entries].sort(
      ([, left], [, right]) =>
        (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0),
    );

    const topEntry = sortedByRecency.find(
      ([, entry]) => !entry.completed && entry.positionSeconds > ENGAGE_SECONDS,
    );
    if (topEntry) {
      const [titleId, top] = topEntry;
      const displayTop = applyYoutubeHistoryEnrichment(top);
      continueWatchingSelection = { titleId, entry: top };
      const ep = historyEpisodeLabel(displayTop);
      const topDuration = displayTop.durationSeconds ?? 0;
      const remainingSecs = topDuration > 0 ? topDuration - top.positionSeconds : 0;
      const remainingLabel =
        remainingSecs > 60 ? `${Math.ceil(remainingSecs / 60)}m left` : undefined;
      continueWatching = {
        title: displayTop.title,
        ep,
        remainingLabel,
        titleId,
        mediaKind: isYoutubeHistoryEntry(displayTop)
          ? "video"
          : historyContentType(displayTop) === "movie"
            ? "movie"
            : "series",
      };
    }

    const cursors = sortedByRecency
      .filter(([, entry]) => historyContentType(entry) === "series")
      .map(([titleId, entry]) => ({
        titleId,
        season: entry.season ?? 1,
        episode: entry.episode ?? entry.absoluteEpisode ?? 1,
      }));
    const readyAssets = container.offlineAssetService.listNextReadyByTitleCursors(cursors);
    const readyByTitle = new Map(readyAssets.map((asset) => [asset.titleId, asset]));
    for (const [titleId, entry] of sortedByRecency) {
      const asset = readyByTitle.get(titleId);
      if (asset?.season === undefined || asset.episode === undefined) continue;
      if (continueWatching?.titleId === titleId) continue;
      offlineReadyNext = {
        title: entry.title,
        ep: `S${String(asset.season).padStart(2, "0")}E${String(asset.episode).padStart(2, "0")}`,
        titleId,
        offlineJobId: asset.originJobId,
      };
      break;
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const progressMap = container.releaseProgressCache.getByTitleIds(entries.map(([id]) => id));
    let airingTodayCount = 0;
    for (const projection of progressMap.values()) {
      if (!projection.nextAiringAt) continue;
      if (projection.nextAiringAt.slice(0, 10) === todayKey) {
        airingTodayCount += 1;
      }
    }
    if (airingTodayCount > 0) {
      calendarNudge = { airingTodayCount };
    }

    // "New since you left": releases the attention system confirmed after the
    // last calendar visit. The `lastCalendarVisitAt <= 0` guard mirrors the
    // calendar's own newness rule — a first-ever visit must not flood the home
    // screen with the entire backlog. Muted titles stay silent even though
    // history-backed rows may still carry projections for them.
    const lastCalendarVisitAt = container.config.lastCalendarVisitAt;
    if (lastCalendarVisitAt > 0) {
      const muted = new Set(
        container.followedTitleRepository.listByPreference("muted").map((record) => record.titleId),
      );
      const fresh = container.releaseProgressCache
        .listNewSince(new Date(lastCalendarVisitAt).toISOString())
        .filter((projection) => !muted.has(projection.titleId) && matchesStoredMode(projection));
      if (fresh.length > 0) {
        newSinceVisit = {
          episodeCount: fresh.reduce((count, row) => count + row.newEpisodeCount, 0),
          titleCount: fresh.length,
          sinceMs: lastCalendarVisitAt,
        };
      }
    }

    const watchlist = container.listService.getWatchlist().filter(matchesStoredMode);
    const topSaved = watchlist[0];
    if (topSaved) {
      savedNext = {
        title: topSaved.title,
        titleId: topSaved.titleId,
        total: watchlist.length,
      };
    }
  } catch {
    // best-effort local reads only
  }

  const idleContext =
    playlistNextItem ||
    continueWatching ||
    offlineReadyNext ||
    savedNext ||
    releaseSummary.episodeCount > 0 ||
    calendarNudge ||
    newSinceVisit
      ? {
          playlistNext: playlistNextItem
            ? {
                title: playlistNextItem.title,
                ep:
                  playlistNextItem.mediaKind === "video" && playlistNextItem.episode !== null
                    ? `#${playlistNextItem.episode}`
                    : playlistNextItem.season !== null && playlistNextItem.episode !== null
                      ? `S${String(playlistNextItem.season).padStart(2, "0")}E${String(playlistNextItem.episode).padStart(2, "0")}`
                      : undefined,
                titleId: playlistNextItem.titleId,
                mediaKind: playlistNextItem.mediaKind,
                season: playlistNextItem.season ?? undefined,
                episode: playlistNextItem.episode ?? undefined,
                absoluteEpisode: playlistNextItem.absoluteEpisode,
              }
            : undefined,
          continueWatching,
          offlineReadyNext,
          savedNext,
          todayReleaseCount: releaseSummary.episodeCount,
          todayReleaseTitleCount: releaseSummary.titleCount,
          newSinceVisit,
          calendarNudge,
        }
      : undefined;

  return { idleContext, continueWatchingSelection };
}

export type ContinueWatchingSelection = {
  readonly titleId: string;
  readonly entry: HistoryProgress;
};

let browseIdleRefreshListener: (() => void) | null = null;

export function setBrowseIdleRefreshListener(listener: (() => void) | null): void {
  browseIdleRefreshListener = listener;
}

export function requestBrowseIdleContextRefresh(): void {
  browseIdleRefreshListener?.();
}
