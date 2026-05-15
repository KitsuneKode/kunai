import { pickEpisodesToDownload } from "@/app/download-episode-checklist";
import type { Phase, PhaseContext, PhaseResult } from "@/app/Phase";
import type { EpisodeInfo, EpisodePickerOption, TitleInfo } from "@/domain/types";
import { DownloadEnqueueRejectedError } from "@/services/download/DownloadService";
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
    const animeEpisodes =
      isAnime && provider
        ? await import("@kunai/providers").then((m) =>
            m
              .fetchAllMangaEpisodeCatalog({
                apiUrl: "https://api.allanime.day/api",
                referer: "https://allmanga.to",
                ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
                showId: input.title.id,
                mode:
                  container.config.animeLanguageProfile.audio === "ja" ||
                  container.config.animeLanguageProfile.audio === "original"
                    ? "sub"
                    : "dub",
              })
              .catch(() => null),
          )
        : undefined;

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

    let episodes = await pickEpisodesToDownload({
      title: input.title,
      isAnime,
      animeEpisodes: animeEpisodes ?? undefined,
      container,
    });

    if (!episodes) {
      const single = await pickSingleDownloadEpisodeFallback({
        title: input.title,
        isAnime,
        animeEpisodes: animeEpisodes ?? undefined,
        container,
      });
      if (!single) {
        return { status: "success", value: "back" };
      }
      episodes = [single];
    }

    const audioPreference =
      state.mode === "anime" ? state.animeLanguageProfile.audio : state.seriesLanguageProfile.audio;
    const subtitlePreference =
      state.mode === "anime"
        ? state.animeLanguageProfile.subtitle
        : state.seriesLanguageProfile.subtitle;

    let queuedCount = 0;
    let lastJobId: string | undefined;
    try {
      for (const episode of episodes) {
        const job = await container.downloadService.enqueue({
          title: input.title,
          episode,
          providerId: state.provider,
          mode: state.mode,
          audioPreference,
          subtitlePreference,
          outputDirectory: input.outputDirectory,
          posterUrl: input.title.posterUrl,
        });
        lastJobId = job.id;
        queuedCount += 1;
      }
    } catch (error) {
      const message =
        error instanceof DownloadEnqueueRejectedError
          ? error.reason
          : error instanceof Error
            ? error.message
            : String(error);
      container.diagnosticsStore.record({
        category: "download",
        message: "Download-only batch enqueue stopped",
        context: { queuedCount, error: message, titleId: input.title.id },
      });
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note:
          queuedCount > 0
            ? `Queued ${queuedCount} download(s), then stopped: ${message}`
            : `Download failed: ${message}`,
      });
      void container.downloadService.processQueue();
      return { status: "success", value: queuedCount > 0 ? "queued" : "back" };
    }

    container.diagnosticsStore.record({
      category: "download",
      message: "Download-only job(s) queued",
      context: {
        jobId: lastJobId,
        count: queuedCount,
        titleId: input.title.id,
        titleName: input.title.name,
      },
    });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note:
        queuedCount === 1
          ? `Download queued: ${input.title.name}`
          : `Downloads queued: ${queuedCount} episodes · ${input.title.name}`,
    });
    void container.downloadService.processQueue();
    return { status: "success", value: "queued" };
  }
}

async function pickSingleDownloadEpisodeFallback({
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
