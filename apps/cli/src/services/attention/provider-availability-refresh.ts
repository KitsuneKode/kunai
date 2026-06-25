import type { TitleInfo } from "@/domain/types";
import { readLatestHistoryByTitle } from "@/services/continuation/history-progress";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { PlaybackResolveWorkService } from "@/services/playback/PlaybackResolveWorkService";
import type { HistoryRepository, ReleaseProgressCacheRepository } from "@kunai/storage";

const MIN_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export function createProviderAvailabilityRefresh(deps: {
  readonly playbackResolveWork: Pick<PlaybackResolveWorkService, "resolve">;
  readonly releaseProgressCache: Pick<ReleaseProgressCacheRepository, "getByTitleIds">;
  readonly historyRepository: HistoryRepository;
  readonly diagnostics?: Pick<DiagnosticsService, "record">;
  readonly getMode: () => string;
  readonly getProviderId: () => string;
  readonly getAudioPreference?: () => string;
  readonly getSubtitlePreference?: () => string;
}): (titleId: string, signal: AbortSignal) => Promise<void> {
  const lastCheckedAt = new Map<string, number>();

  return async (titleId, signal) => {
    const nowMs = Date.now();
    const previous = lastCheckedAt.get(titleId);
    if (previous !== undefined && nowMs - previous < MIN_REFRESH_INTERVAL_MS) return;
    lastCheckedAt.set(titleId, nowMs);

    const historyRow = readLatestHistoryByTitle(deps.historyRepository)[titleId];
    const projection = deps.releaseProgressCache.getByTitleIds([titleId]).get(titleId);
    const season = projection?.latestAiredSeason ?? historyRow?.season ?? 1;
    const episode = projection?.latestAiredEpisode ?? historyRow?.episode ?? 1;
    const title: TitleInfo = {
      id: titleId,
      name: projection?.title ?? historyRow?.title ?? titleId,
      type:
        projection?.mediaKind === "movie" || historyRow?.mediaKind === "movie" ? "movie" : "series",
    };
    const shellMode = deps.getMode() === "anime" ? "anime" : "series";

    const result = await deps.playbackResolveWork.resolve(
      {
        title,
        episode: { season, episode },
        mode: shellMode,
        providerId: historyRow?.providerId ?? deps.getProviderId(),
        audioPreference: deps.getAudioPreference?.() ?? "original",
        subtitlePreference: deps.getSubtitlePreference?.() ?? "en",
        signal,
      },
      { intentKind: "diagnostic", budgetLane: "background" },
    );

    deps.diagnostics?.record({
      category: "runtime",
      message: "Provider availability refresh completed",
      titleId,
      providerId: result.providerId,
      context: {
        playable: Boolean(result.stream),
        season,
        episode,
      },
    });
  };
}
