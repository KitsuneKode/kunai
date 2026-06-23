import type { BrowseIdleContext } from "@/app-shell/types";
import type { Container } from "@/container";
import {
  historyContentType,
  readLatestHistoryByTitle,
} from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@kunai/storage";

type IdleContextContainer = Pick<
  Container,
  "queueService" | "releaseProgressCache" | "offlineAssetService" | "historyRepository"
>;

export async function buildBrowseIdleContext(
  container: IdleContextContainer,
  options?: {
    readonly preloadedHistory?: Record<string, HistoryProgress>;
  },
): Promise<{
  readonly idleContext: BrowseIdleContext | undefined;
  readonly continueWatchingSelection: ContinueWatchingSelection | null;
}> {
  const playlistNextItem = container.queueService.peekNext();
  const releaseSummary = container.releaseProgressCache.summarizeActive();

  let continueWatching: BrowseIdleContext["continueWatching"];
  let continueWatchingSelection: ContinueWatchingSelection | null = null;
  let offlineReadyNext: BrowseIdleContext["offlineReadyNext"];
  let calendarNudge: BrowseIdleContext["calendarNudge"];

  try {
    const allHistory =
      options?.preloadedHistory ?? readLatestHistoryByTitle(container.historyRepository);
    const entries = Object.entries(allHistory);
    const sortedByRecency = [...entries].sort(
      ([, left], [, right]) =>
        (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0),
    );

    const topEntry = sortedByRecency.find(
      ([, entry]) => !entry.completed && entry.positionSeconds > 30,
    );
    if (topEntry) {
      const [titleId, top] = topEntry;
      continueWatchingSelection = { titleId, entry: top };
      const ep =
        historyContentType(top) === "series" &&
        typeof top.season === "number" &&
        typeof top.episode === "number"
          ? `S${String(top.season).padStart(2, "0")}E${String(top.episode).padStart(2, "0")}`
          : undefined;
      const topDuration = top.durationSeconds ?? 0;
      const remainingSecs = topDuration > 0 ? topDuration - top.positionSeconds : 0;
      const remainingLabel =
        remainingSecs > 60 ? `${Math.ceil(remainingSecs / 60)}m left` : undefined;
      continueWatching = {
        title: top.title,
        ep,
        remainingLabel,
        titleId,
        mediaKind: historyContentType(top) === "movie" ? "movie" : "series",
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
  } catch {
    // best-effort local reads only
  }

  const idleContext =
    playlistNextItem ||
    continueWatching ||
    offlineReadyNext ||
    releaseSummary.episodeCount > 0 ||
    calendarNudge
      ? {
          playlistNext: playlistNextItem
            ? {
                title: playlistNextItem.title,
                ep:
                  playlistNextItem.season !== null && playlistNextItem.episode !== null
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
          todayReleaseCount: releaseSummary.episodeCount,
          todayReleaseTitleCount: releaseSummary.titleCount,
          calendarNudge,
        }
      : undefined;

  return { idleContext, continueWatchingSelection };
}

export type ContinueWatchingSelection = {
  readonly titleId: string;
  readonly entry: HistoryProgress;
};
