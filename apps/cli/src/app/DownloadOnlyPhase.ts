import { chooseFromListShell } from "@/app-shell/pickers/choose-from-list-shell";
import { buildPickerActionContext } from "@/app-shell/workflows";
import { pickEpisodesToDownload } from "@/app/download-episode-checklist";
import type { Phase, PhaseContext, PhaseResult } from "@/app/Phase";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import { DownloadEnqueueRejectedError } from "@/services/download/DownloadService";
import { chooseStartingEpisode } from "@/session-flow";

export type DownloadOnlyInput = {
  readonly title: TitleInfo;
  readonly outputDirectory?: string;
};

export type DownloadConfirmationProfile = {
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly qualityPreference?: string;
  readonly cacheArtwork: boolean;
  readonly outputDirectory?: string;
  readonly enrollKeepWatchingOffline: boolean;
  readonly runwayTarget?: number;
  readonly cleanupPolicy: OfflineCleanupPolicy;
};

export type OfflineCleanupPolicy =
  | { readonly mode: "keep-last-watched"; readonly count: number }
  | { readonly mode: "cleanup-watched"; readonly graceDays: number };

export type DownloadConfirmationEditAction =
  | "cycle-subtitle"
  | "cycle-quality"
  | "toggle-artwork"
  | "toggle-destination"
  | "increase-runway"
  | "decrease-runway"
  | "toggle-cleanup";

type DownloadOnlyPhaseDependencies = {
  readonly pickEpisodes?: (args: {
    readonly title: TitleInfo;
    readonly isAnime: boolean;
    readonly container: PhaseContext["container"];
  }) => Promise<readonly EpisodeInfo[] | null>;
  readonly confirmProfile?: (args: {
    readonly title: TitleInfo;
    readonly episodes: readonly EpisodeInfo[];
    readonly profile: DownloadConfirmationProfile;
    readonly container: PhaseContext["container"];
  }) => Promise<DownloadConfirmationProfile | null>;
  readonly prepareConfirmedTitle?: (title: TitleInfo, context: PhaseContext) => Promise<TitleInfo>;
};

/** Queue a title/episode for download without launching mpv. */
export class DownloadOnlyPhase implements Phase<DownloadOnlyInput, "queued" | "back"> {
  readonly name = "download-only";

  constructor(private readonly deps: DownloadOnlyPhaseDependencies = {}) {}

  async execute(
    input: DownloadOnlyInput,
    context: PhaseContext,
  ): Promise<PhaseResult<"queued" | "back">> {
    const { container } = context;
    const state = container.stateManager.getState();
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

    const isAnime = state.mode === "anime";
    let episodes: readonly EpisodeInfo[] | null;

    if (input.title.type === "movie") {
      episodes = [{ season: 1, episode: 1 }];
    } else {
      episodes = this.deps.pickEpisodes
        ? await this.deps.pickEpisodes({ title: input.title, isAnime, container })
        : await pickEpisodesToDownload({
            title: input.title,
            isAnime,
            animeEpisodes: undefined,
            container,
          });
    }

    if (!episodes || episodes.length === 0) {
      const single = await pickSingleDownloadEpisodeFallback({
        title: input.title,
        isAnime,
        container,
      });
      if (!single) {
        return { status: "success", value: "back" };
      }
      episodes = [single];
    }

    const proposedProfile = buildDownloadConfirmationProfile(input, context);
    const profile = this.deps.confirmProfile
      ? await this.deps.confirmProfile({
          title: input.title,
          episodes,
          profile: proposedProfile,
          container,
        })
      : await confirmDownloadProfile({
          title: input.title,
          episodes,
          profile: proposedProfile,
          container,
        });
    if (!profile) return { status: "success", value: "back" };
    const confirmedTitle = this.deps.prepareConfirmedTitle
      ? await this.deps.prepareConfirmedTitle(input.title, context)
      : input.title;
    const existingPolicy =
      confirmedTitle.type !== "movie"
        ? container.offlineTitlePolicies.get(confirmedTitle.id)
        : undefined;
    const persistSeriesPolicy = () => {
      if (confirmedTitle.type === "movie") return;
      const enrolled = profile.enrollKeepWatchingOffline || existingPolicy?.enrolled === true;
      container.offlineTitlePolicies.upsert({
        titleId: confirmedTitle.id,
        titleName: confirmedTitle.name,
        mediaKind: state.mode === "anime" ? "anime" : "series",
        enrolled,
        runwayTarget: profile.enrollKeepWatchingOffline
          ? (profile.runwayTarget ?? container.config.offlineDefaultRunwayTarget)
          : (existingPolicy?.runwayTarget ??
            profile.runwayTarget ??
            container.config.offlineDefaultRunwayTarget),
        profileJson: JSON.stringify({
          audio: profile.audioPreference,
          subtitle: profile.subtitlePreference,
          quality: profile.qualityPreference,
          cacheArtwork: profile.cacheArtwork,
        }),
        cleanupJson: JSON.stringify(profile.cleanupPolicy),
        pausedReason: profile.enrollKeepWatchingOffline ? undefined : existingPolicy?.pausedReason,
        updatedAt: new Date().toISOString(),
      });
      if (profile.enrollKeepWatchingOffline) {
        container.offlineRunwayService.enqueueEvaluation(confirmedTitle.id, "policy-change");
      }
    };

    let queuedCount = 0;
    let lastJobId: string | undefined;
    try {
      for (const episode of episodes) {
        const job = await container.downloadService.enqueue({
          title: confirmedTitle,
          episode,
          providerId: state.provider,
          mode: state.mode,
          audioPreference: profile.audioPreference,
          subtitlePreference: profile.subtitlePreference,
          qualityPreference: profile.qualityPreference,
          outputDirectory: profile.outputDirectory,
          posterUrl: profile.cacheArtwork ? confirmedTitle.posterUrl : undefined,
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
      if (queuedCount > 0) persistSeriesPolicy();
      void container.downloadService.processQueue();
      return { status: "success", value: queuedCount > 0 ? "queued" : "back" };
    }

    container.diagnosticsStore.record({
      category: "download",
      operation: "download.profile.confirmed",
      message: "Download-only job(s) queued",
      context: {
        jobId: lastJobId,
        count: queuedCount,
        titleId: confirmedTitle.id,
        titleName: confirmedTitle.name,
        cacheArtwork: profile.cacheArtwork,
        keepWatchingOffline: profile.enrollKeepWatchingOffline,
        runwayTarget: profile.runwayTarget ?? null,
      },
    });
    persistSeriesPolicy();
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note:
        queuedCount === 1
          ? `Download queued: ${confirmedTitle.name}`
          : `Downloads queued: ${queuedCount} episodes · ${confirmedTitle.name}`,
    });
    void container.downloadService.processQueue();
    return { status: "success", value: "queued" };
  }
}

async function pickSingleDownloadEpisodeFallback({
  title,
  isAnime,
  container,
}: {
  readonly title: TitleInfo;
  readonly isAnime: boolean;
  readonly container: PhaseContext["container"];
}): Promise<EpisodeInfo | null> {
  if (title.type === "movie") {
    return { season: 1, episode: 1 };
  }

  const selected = await chooseStartingEpisode({
    currentId: title.id,
    isAnime,
    animeEpisodeCount: title.episodeCount,
    animeEpisodes: undefined,
    flags: {},
    getHistoryEntry: () => container.historyStore.get(title.id),
    container,
  });
  if (!selected) return null;
  return { season: selected.season, episode: selected.episode };
}

function buildDownloadConfirmationProfile(
  input: DownloadOnlyInput,
  context: PhaseContext,
): DownloadConfirmationProfile {
  const state = context.container.stateManager.getState();
  const language =
    state.mode === "anime" ? state.animeLanguageProfile : state.seriesLanguageProfile;
  return {
    audioPreference: language.audio,
    subtitlePreference: language.subtitle,
    qualityPreference: language.quality,
    cacheArtwork: context.container.config.offlineArtworkCacheEnabled,
    outputDirectory: input.outputDirectory || context.container.config.downloadPath || undefined,
    enrollKeepWatchingOffline: false,
    runwayTarget: context.container.config.offlineDefaultRunwayTarget,
    cleanupPolicy: { mode: "keep-last-watched", count: 1 },
  };
}

export function updateDownloadConfirmationProfile(
  profile: DownloadConfirmationProfile,
  action: DownloadConfirmationEditAction,
  configuredOutputDirectory?: string,
  configuredCleanupGraceDays = 7,
): DownloadConfirmationProfile {
  if (action === "cycle-subtitle") {
    const options = ["en", "none", "interactive"];
    const current = Math.max(0, options.indexOf(profile.subtitlePreference));
    return { ...profile, subtitlePreference: options[(current + 1) % options.length] ?? "en" };
  }
  if (action === "cycle-quality") {
    const options = ["best", "1080p", "720p"];
    const current = Math.max(0, options.indexOf(profile.qualityPreference ?? "best"));
    return { ...profile, qualityPreference: options[(current + 1) % options.length] ?? "best" };
  }
  if (action === "toggle-artwork") return { ...profile, cacheArtwork: !profile.cacheArtwork };
  if (action === "toggle-destination") {
    return {
      ...profile,
      outputDirectory: profile.outputDirectory ? undefined : configuredOutputDirectory || undefined,
    };
  }
  if (action === "increase-runway") {
    return { ...profile, runwayTarget: Math.min(10, (profile.runwayTarget ?? 1) + 1) };
  }
  if (action === "decrease-runway") {
    return { ...profile, runwayTarget: Math.max(1, (profile.runwayTarget ?? 1) - 1) };
  }
  return {
    ...profile,
    cleanupPolicy:
      profile.cleanupPolicy.mode === "cleanup-watched"
        ? { mode: "keep-last-watched", count: 1 }
        : { mode: "cleanup-watched", graceDays: configuredCleanupGraceDays },
  };
}

async function confirmDownloadProfile({
  title,
  episodes,
  profile,
  container,
}: {
  readonly title: TitleInfo;
  readonly episodes: readonly EpisodeInfo[];
  readonly profile: DownloadConfirmationProfile;
  readonly container: PhaseContext["container"];
}): Promise<DownloadConfirmationProfile | null> {
  let draft = profile;
  while (true) {
    const target = draft.outputDirectory ? "configured folder" : "default offline library";
    const cleanup =
      draft.cleanupPolicy.mode === "cleanup-watched"
        ? `cleanup suggestions after ${draft.cleanupPolicy.graceDays} days`
        : "keep last watched local";
    const profileDetail = [
      `${draft.audioPreference} audio`,
      `${draft.subtitlePreference} subtitles`,
      draft.qualityPreference ? `${draft.qualityPreference} quality` : null,
      draft.cacheArtwork ? "artwork cached" : "no artwork cache",
      target,
      cleanup,
      "space checked before queue and start",
    ]
      .filter(Boolean)
      .join(" · ");
    const selection = await chooseFromListShell<
      "queue" | "runway" | "back" | DownloadConfirmationEditAction
    >({
      title: `Download ${title.name}?`,
      subtitle: `${episodes.length} ${episodes.length === 1 ? "item" : "items"} selected · profile edits are local until you queue`,
      actionContext: buildPickerActionContext({ container, taskLabel: `Download: ${title.name}` }),
      options: [
        { value: "back", label: "Back", detail: "No download queued and no provider stream work" },
        { value: "queue", label: "Queue download", detail: profileDetail },
        ...(title.type !== "movie"
          ? [
              {
                value: "runway" as const,
                label: "Queue and keep watching offline",
                detail: `${profileDetail} · keep up to ${draft.runwayTarget ?? 1} released episodes ready`,
              },
            ]
          : []),
        {
          value: "cycle-subtitle",
          label: `Subtitles: ${draft.subtitlePreference}`,
          detail: "Cycle downloaded subtitle preference",
        },
        {
          value: "cycle-quality",
          label: `Quality: ${draft.qualityPreference ?? "best"}`,
          detail: "Cycle stored download quality preference",
        },
        {
          value: "toggle-artwork",
          label: `Artwork cache: ${draft.cacheArtwork ? "on" : "off"}`,
          detail: "Include title artwork in offline assets",
        },
        ...(container.config.downloadPath.trim()
          ? [
              {
                value: "toggle-destination" as const,
                label: `Destination: ${target}`,
                detail:
                  "Switch between configured folder and default library; set new paths in Settings",
              },
            ]
          : []),
        ...(title.type !== "movie"
          ? [
              {
                value: "increase-runway" as const,
                label: `Offline runway: ${draft.runwayTarget ?? 1} episode(s)`,
                detail: "Increase bounded target; disk checks can pause new downloads",
              },
              {
                value: "decrease-runway" as const,
                label: "Reduce offline runway",
                detail: "Reduce the ready-ahead target by one episode",
              },
              {
                value: "toggle-cleanup" as const,
                label: `After watching: ${cleanup}`,
                detail: "Controls explicit cleanup suggestions; files are not deleted here",
              },
            ]
          : []),
      ],
    });
    if (!selection || selection === "back") return null;
    if (selection === "queue" || selection === "runway") {
      return { ...draft, enrollKeepWatchingOffline: selection === "runway" };
    }
    draft = updateDownloadConfirmationProfile(
      draft,
      selection,
      container.config.downloadPath,
      container.config.autoCleanupGraceDays,
    );
  }
}
