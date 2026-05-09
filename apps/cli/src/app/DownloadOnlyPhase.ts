import type { Phase, PhaseContext, PhaseResult } from "@/app/Phase";
import type { EpisodeInfo, EpisodePickerOption, TitleInfo } from "@/domain/types";
import { chooseStartingEpisode } from "@/session-flow";

export type DownloadOnlyInput = {
  readonly title: TitleInfo;
  readonly outputDirectory?: string;
};

/** Queue a title/episode for download without launching mpv. */
export class DownloadOnlyPhase implements Phase<DownloadOnlyInput, "queued" | "back"> {
  readonly name = "download-only";

  async execute(
    input: DownloadOnlyInput,
    context: PhaseContext,
  ): Promise<PhaseResult<"queued" | "back">> {
    const { container } = context;
    const state = container.stateManager.getState();
    const provider = container.providerRegistry.get(state.provider);
    const isAnime = state.mode === "anime";
    const animeEpisodes = isAnime
      ? await provider?.listEpisodes?.({ title: input.title }, context.signal).catch(() => null)
      : undefined;

    const episode = await selectDownloadEpisode({
      title: input.title,
      isAnime,
      animeEpisodes: animeEpisodes ?? undefined,
      container,
    });
    if (!episode) {
      return { status: "success", value: "back" };
    }

    const eligibility = container.downloadService.getEnqueueEligibility();
    if (!eligibility.allowed) {
      container.diagnosticsStore.record({
        category: "download",
        message: "Download-only enqueue blocked",
        context: { code: eligibility.code, reason: eligibility.reason },
      });
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Download unavailable: ${eligibility.reason}`,
      });
      return { status: "success", value: "back" };
    }

    const job = await container.downloadService.enqueue({
      title: input.title,
      episode,
      providerId: state.provider,
      mode: state.mode,
      subLang: state.subLang,
      animeLang: state.animeLang,
      outputDirectory: input.outputDirectory,
    });
    container.diagnosticsStore.record({
      category: "download",
      message: "Download-only job queued",
      context: {
        jobId: job.id,
        titleId: job.titleId,
        season: job.season,
        episode: job.episode,
        outputPath: job.outputPath,
      },
    });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Download queued: ${job.titleName}`,
    });
    void container.downloadService.processQueue();
    return { status: "success", value: "queued" };
  }
}

async function selectDownloadEpisode({
  title,
  isAnime,
  animeEpisodes,
  container,
}: {
  readonly title: TitleInfo;
  readonly isAnime: boolean;
  readonly animeEpisodes?: readonly EpisodePickerOption[];
  readonly container: PhaseContext["container"];
}): Promise<EpisodeInfo | null> {
  if (title.type === "movie") {
    return { season: 1, episode: 1 };
  }

  const selected = await chooseStartingEpisode({
    currentId: title.id,
    isAnime,
    animeEpisodeCount: title.episodeCount,
    animeEpisodes,
    flags: {},
    getHistoryEntry: () => container.historyStore.get(title.id),
    container,
  });
  if (!selected) return null;
  return { season: selected.season, episode: selected.episode };
}
