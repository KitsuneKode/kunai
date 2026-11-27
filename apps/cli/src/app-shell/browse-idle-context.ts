import { formatLocalDayKey } from "@/app-shell/calendar-ui.model";
import type { BrowseIdleContext } from "@/app-shell/types";
import type { Container } from "@/container";
import {
  historyLaunchSelectionFromContinuation,
  type HistoryLaunchSelection,
} from "@/services/continuation/continuation-launch-selection";
import { firstPlayableContinuation } from "@/services/continuation/ContinueWatchingService";
import {
  cachedContinuationSignals,
  offlineContinuationSignal,
} from "@/services/continuation/history-continuation-signals";
import {
  historyContentType,
  historyEpisodeLabel,
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
  let savedNext: BrowseIdleContext["savedNext"];
  let calendarNudge: BrowseIdleContext["calendarNudge"];
  let newSinceVisit: BrowseIdleContext["newSinceVisit"];

  try {
    const allHistory =
      options?.preloadedHistory ?? readLatestHistoryByTitle(container.historyRepository);
    const entries = Object.entries(allHistory);
    const sortedByRecency = [...entries].sort(
      ([, left], [, right]) =>
        (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0),
    );

    const cursors = sortedByRecency
      .filter(([, entry]) => historyContentType(entry) === "series")
      .map(([titleId, entry]) => ({
        titleId,
        season: entry.season ?? 1,
        episode: entry.episode ?? entry.absoluteEpisode ?? 1,
      }));
    const readyAssets = container.offlineAssetService.listNextReadyByTitleCursors(cursors);
    const readyByTitle = new Map(readyAssets.map((asset) => [asset.titleId, asset]));
    const releaseByTitle = container.releaseProgressCache.getByTitleIds(
      sortedByRecency.map(([titleId]) => titleId),
    );

    // The same rule as `--continue`: the newest title with something to play —
    // resume an unfinished episode, or the next aired one after a finished
    // episode. A downloaded next episode is left to the offline row below.
    const decision = firstPlayableContinuation(
      sortedByRecency,
      (titleId, anchor) => {
        const asset = readyByTitle.get(titleId);
        return cachedContinuationSignals({
          entry: anchor,
          releaseProgress: releaseByTitle.get(titleId),
          offline: offlineContinuationSignal(
            false,
            asset?.season !== undefined && asset.episode !== undefined
              ? { season: asset.season, episode: asset.episode, jobId: asset.originJobId }
              : undefined,
          ),
        });
      },
      (candidate) => candidate.primaryAction?.kind !== "play-local",
    );
    const sourceEntry = decision?.target ? allHistory[decision.target.titleId] : undefined;
    if (decision?.target && sourceEntry) {
      const { target } = decision;
      const displayTop = applyYoutubeHistoryEnrichment(sourceEntry);
      continueWatchingSelection = historyLaunchSelectionFromContinuation({
        ...decision,
        target: { ...target, sourceEntry },
      });
      const isResume = decision.state === "resume";
      const topDuration = displayTop.durationSeconds ?? 0;
      const remainingSecs =
        isResume && topDuration > 0 ? topDuration - sourceEntry.positionSeconds : 0;
      continueWatching = {
        title: displayTop.title,
        ep: isResume
          ? historyEpisodeLabel(displayTop)
          : historyEpisodeLabel({ ...displayTop, season: target.season, episode: target.episode }),
        remainingLabel: remainingSecs > 60 ? `${Math.ceil(remainingSecs / 60)}m left` : undefined,
        titleId: target.titleId,
        mediaKind: target.mediaKind,
        nextUp: !isResume,
      };
    }

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

    // Local dates on both sides, as the calendar this nudge opens uses: the
    // UTC date of "now" and of each airing time put a user east or west of
    // UTC on the wrong day, so the nudge and the calendar's Today disagreed.
    // Muted titles stay silent here too.
    const todayKey = formatLocalDayKey(new Date());
    const mutedTitles = new Set(
      container.followedTitleRepository.listByPreference("muted").map((record) => record.titleId),
    );
    const progressMap = container.releaseProgressCache.getByTitleIds(entries.map(([id]) => id));
    let airingTodayCount = 0;
    for (const projection of progressMap.values()) {
      if (!projection.nextAiringAt || mutedTitles.has(projection.titleId)) continue;
      const airingAt = new Date(projection.nextAiringAt);
      if (!Number.isNaN(airingAt.getTime()) && formatLocalDayKey(airingAt) === todayKey) {
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
      const fresh = container.releaseProgressCache
        .listNewSince(new Date(lastCalendarVisitAt).toISOString())
        .filter((projection) => !mutedTitles.has(projection.titleId));
      if (fresh.length > 0) {
        newSinceVisit = {
          episodeCount: fresh.reduce((count, row) => count + row.newEpisodeCount, 0),
          titleCount: fresh.length,
          sinceMs: lastCalendarVisitAt,
        };
      }
    }

    const watchlist = container.listService.getWatchlist();
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
                // Movie queue items carry `undefined` (not `null`) for season and
                // episode; a strict `!== null` check rendered "SundefinedEundefined".
                ep:
                  playlistNextItem.mediaKind === "video" &&
                  (playlistNextItem.episode ?? null) !== null
                    ? `#${playlistNextItem.episode}`
                    : (playlistNextItem.season ?? null) !== null &&
                        (playlistNextItem.episode ?? null) !== null
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

/** What the home row's continue launches: the history row and the episode to start. */
export type ContinueWatchingSelection = HistoryLaunchSelection;

let browseIdleRefreshListener: (() => void) | null = null;

export function setBrowseIdleRefreshListener(listener: (() => void) | null): void {
  browseIdleRefreshListener = listener;
}

export function requestBrowseIdleContextRefresh(): void {
  browseIdleRefreshListener?.();
}
