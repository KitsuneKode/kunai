import { runAutoplayAdvanceCountdown } from "@/app/autoplay-advance-countdown";
import type { Container } from "@/container";
import { createSourceSelectionEngine } from "@/domain/playback-source/SourceSelectionEngine";
import type { StreamInfo } from "@/domain/types";
import { offlineResumeSecondsForJob } from "@/services/offline/offline-history-progress";

export async function playCompletedDownload(container: Container, jobId: string): Promise<void> {
  let currentJobId: string | undefined = jobId;
  let isFirstEpisode = true;

  try {
    while (currentJobId) {
      const playable = await container.offlineLibraryService.getPlayableSource(currentJobId);
      if (playable.status !== "ready") {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: `Offline file unavailable: ${playable.status}. Check integrity first.`,
        });
        return;
      }

      const decision = createSourceSelectionEngine().decide({
        entrypoint: "offline-library",
        local: { status: "ready", jobId: currentJobId },
        networkAvailable: true,
        preference: "prefer-local",
      });
      container.diagnosticsService.record({
        category: "playback",
        message: "Offline source selected (unified play)",
        context: {
          jobId: currentJobId,
          sourceDecision: decision.reason,
          shouldResolveOnline: decision.shouldResolveOnline,
        },
      });

      const resumeSeconds = isFirstEpisode
        ? offlineResumeSecondsForJob(
            playable.job,
            container.historyRepository.listByTitle(playable.source.titleId),
          )
        : 0;
      const offlineDisplayTitle = formatOfflinePlaybackTitle(playable.source);
      const localStream: StreamInfo = {
        url: playable.source.filePath,
        headers: {},
        subtitle: playable.source.subtitlePath ?? undefined,
        title: offlineDisplayTitle,
        timestamp: Date.now(),
      };

      const result = await container.player.play(localStream, {
        url: playable.source.filePath,
        displayTitle: offlineDisplayTitle,
        playbackMode: "autoplay-chain",
        resumePromptAt: resumeSeconds,
        resumeStartChoicePrompt: container.config.resumeStartChoicePrompt,
        timing: playable.source.timing ?? null,
        autoSkipEnabled: !container.stateManager.getState().autoskipSessionPaused,
        skipRecap: container.config.skipRecap,
        skipIntro: container.config.skipIntro,
        skipPreview: container.config.skipPreview,
        skipCredits: container.config.skipCredits,
      });
      const persisted = await container.offlineLibraryService.savePlaybackHistory(
        playable.source,
        result,
      );
      if (persisted) {
        container.offlineRunwayService.enqueueEvaluation(
          playable.source.titleId,
          "offline-playback-complete",
        );
      }

      isFirstEpisode = false;
      currentJobId = await resolveNextDownloadedJobId(container, playable.source, result.endReason);
    }
  } finally {
    await container.player.releasePersistentSession();
  }
}

function formatOfflinePlaybackTitle(source: {
  readonly titleName: string;
  readonly season?: number | null;
  readonly episode?: number | null;
}): string {
  if (typeof source.season !== "number" || typeof source.episode !== "number") {
    return source.titleName;
  }
  const season = String(source.season).padStart(2, "0");
  const episode = String(source.episode).padStart(2, "0");
  return `${source.titleName} · S${season}E${episode}`;
}

async function resolveNextDownloadedJobId(
  container: Container,
  source: { readonly titleId: string; readonly season?: number; readonly episode?: number },
  endReason: string,
): Promise<string | undefined> {
  const state = container.stateManager.getState();
  if (
    endReason !== "eof" ||
    !container.config.autoNext ||
    state.autoplaySessionPaused ||
    state.stopAfterCurrent
  ) {
    return undefined;
  }

  const nextJobId = findNextDownloadedJobId(container, source);
  if (!nextJobId) return undefined;

  const outcome = await runAutoplayAdvanceCountdown({
    seconds: 5,
    sleep: (ms) => Bun.sleep(ms),
    onTick: (remaining) =>
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Up next (offline) in ${remaining}s · a to pause`,
      }),
    isCancelled: () => container.stateManager.getState().autoplaySessionPaused,
  });
  if (outcome === "cancelled") {
    container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note: null });
    return undefined;
  }
  return nextJobId;
}

function findNextDownloadedJobId(
  container: Container,
  source: { readonly titleId: string; readonly season?: number; readonly episode?: number },
): string | undefined {
  if (typeof source.season !== "number" || typeof source.episode !== "number") return undefined;
  const nextEpisode = source.episode + 1;
  const next = container.offlineAssetService
    .listTitleAssets(source.titleId)
    .find(
      (asset) =>
        asset.state === "ready" && asset.season === source.season && asset.episode === nextEpisode,
    );
  return next?.originJobId;
}
