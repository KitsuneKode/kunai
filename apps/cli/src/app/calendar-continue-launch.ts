import {
  buildRootHistorySelection,
  releaseProgressToContinueHistoryRelease,
  type RootHistorySelection,
} from "@/app-shell/root-history-bridge";
import {
  applyHistorySelectionProvider,
  episodeFromHistorySelection,
  prepareReplayTitleForProvider,
  titleFromHistorySelection,
} from "@/app/launch-entry";
import { playCompletedDownload } from "@/app/offline-playback";
import type { Container } from "@/container";
import type { SearchResult } from "@/domain/types";
import type { TitleInfo } from "@/domain/types";
import type { CatalogScheduleItem } from "@/services/catalog/CatalogScheduleService";
import {
  recordContinuationProjectDecision,
  recordContinuationSourceResolution,
} from "@/services/continuation/continuation-diagnostics";
import { projectionFromViewDecision } from "@/services/continuation/continuation-policy";
import type { ContinuationSignals } from "@/services/continuation/ContinueWatchingService";
import {
  historyContentType,
  readLatestHistoryByTitle,
} from "@/services/continuation/history-progress";
import type { HistoryProgress, ReleaseProgressProjection } from "@kunai/storage";

export type CalendarContinueLaunchResult = {
  readonly selection: RootHistorySelection;
  readonly title: TitleInfo;
};

export function buildCalendarContinuationSignals(input: {
  readonly item: Pick<CatalogScheduleItem, "episode" | "season" | "status" | "releaseAt">;
  readonly entry: HistoryProgress;
  readonly progress?: ReleaseProgressProjection;
}): ContinuationSignals {
  const { item, entry, progress } = input;
  const newEpisodeCount =
    progress && progress.status === "new-episodes" ? Math.max(0, progress.newEpisodeCount) : 0;
  return {
    nextRelease:
      typeof item.episode === "number"
        ? {
            season: item.season ?? entry.season ?? 1,
            episode: item.episode,
            released: item.status === "released",
            availableAt: item.releaseAt ?? undefined,
          }
        : null,
    releaseProgress: newEpisodeCount > 0 ? { newEpisodeCount } : null,
  };
}

function readOfflineSignals(
  container: Pick<Container, "offlineTitlePolicies" | "offlineAssetService" | "historyRepository">,
  titleId: string,
  entry: HistoryProgress,
): ContinuationSignals["offline"] {
  const policy = container.offlineTitlePolicies.listByTitleIds([titleId])[0];
  if (historyContentType(entry) !== "series") {
    return policy ? { enrolled: policy.enrolled === true, readyNextEpisodes: [] } : null;
  }
  const cursor = {
    titleId,
    season: entry.season ?? 1,
    episode: entry.episode ?? entry.absoluteEpisode ?? 1,
  };
  const ready = container.offlineAssetService.listNextReadyByTitleCursors([cursor])[0];
  if (!policy && !ready) return null;
  return {
    enrolled: policy?.enrolled === true,
    readyNextEpisodes:
      ready?.season !== undefined && ready.episode !== undefined
        ? [
            {
              season: ready.season,
              episode: ready.episode,
              jobId: ready.originJobId,
            },
          ]
        : [],
  };
}

export function resolveCalendarContinueSelection(
  container: Pick<
    Container,
    | "continueWatchingService"
    | "historyRepository"
    | "releaseProgressCache"
    | "offlineTitlePolicies"
    | "offlineAssetService"
    | "config"
    | "diagnosticsService"
  >,
  result: SearchResult,
): RootHistorySelection | null {
  const continuation = result.calendar?.continuation;
  if (!continuation?.playable || !continuation.targetTitleId) return null;

  const history = readLatestHistoryByTitle(container.historyRepository);
  const entry = history[continuation.targetTitleId];
  if (!entry) return null;

  const progress = container.releaseProgressCache
    ?.getByTitleIds([continuation.targetTitleId])
    .get(continuation.targetTitleId);
  const scheduleItem = calendarScheduleFromResult(result);
  const signals: ContinuationSignals = {
    ...buildCalendarContinuationSignals({
      item: scheduleItem,
      entry,
      progress,
    }),
    offline: readOfflineSignals(container, continuation.targetTitleId, entry),
  };

  const decision = container.continueWatchingService.titleDecision(
    continuation.targetTitleId,
    signals,
  );
  if (!decision.target || !decision.primaryAction) return null;

  const projection = projectionFromViewDecision(decision);
  const nextRelease = releaseProgressToContinueHistoryRelease(progress);
  const preference = container.config.continueSourcePreference ?? "auto";
  const selection = buildRootHistorySelection(
    { titleId: continuation.targetTitleId, entry },
    nextRelease ? new Map([[continuation.targetTitleId, nextRelease]]) : undefined,
    new Map([[continuation.targetTitleId, projection]]),
    { sourcePreference: preference },
  );

  recordContinuationProjectDecision(container, {
    surface: "calendar",
    titleId: selection.titleId,
    state: decision.state,
    actionKind: decision.primaryAction.kind,
    season: decision.target.season,
    episode: decision.target.episode,
    freshness: decision.freshness,
  });

  recordContinuationSourceResolution(container, {
    surface: "calendar",
    selection,
    preference,
    resolved: selection.localJobId ? "local" : "stream",
  });

  return selection;
}

export async function launchCalendarContinue(
  container: Container,
  result: SearchResult,
): Promise<CalendarContinueLaunchResult | null> {
  const selection = resolveCalendarContinueSelection(container, result);
  if (!selection) return null;

  if (selection.localJobId) {
    await playCompletedDownload(container, selection.localJobId);
  } else {
    applyHistorySelectionProvider(container, selection);
    const episode = episodeFromHistorySelection(selection);
    if (episode) {
      container.stateManager.dispatch({ type: "SELECT_EPISODE", episode });
    }
  }

  const title = await prepareReplayTitleForProvider(
    container,
    titleFromHistorySelection(selection),
    selection.entry,
  );
  return { selection, title };
}

function calendarScheduleFromResult(
  result: SearchResult,
): Pick<CatalogScheduleItem, "episode" | "season" | "status" | "releaseAt"> {
  const calendar = result.calendar;
  return {
    episode: calendar?.episode ?? result.episodeCount,
    season: calendar?.season,
    status: calendar?.releaseStatus === "released" ? "released" : "upcoming",
    releaseAt: calendar?.releaseAt ?? null,
  };
}
