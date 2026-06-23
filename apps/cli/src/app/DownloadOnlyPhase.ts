import { chooseFromListShell } from "@/app-shell/pickers/choose-from-list-shell";
import { buildPickerActionContext } from "@/app-shell/workflows";
import { pickEpisodesToDownload } from "@/app/download-episode-checklist";
import type { Phase, PhaseContext, PhaseResult } from "@/app/Phase";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import {
  buildDefaultDownloadProfile,
  commitDownloadIntent,
  type DownloadConfirmationProfile,
} from "@/services/download/DownloadIntentService";
import { chooseStartingEpisode } from "@/session-flow";

export type DownloadOnlyInput = {
  readonly title: TitleInfo;
  readonly outputDirectory?: string;
};

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
      container.diagnosticsService.record({
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

    const proposedProfile = buildDefaultDownloadProfile(container, {
      outputDirectory: input.outputDirectory,
    });
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

    const result = await commitDownloadIntent(container, {
      title: confirmedTitle,
      episodes,
      profile,
    });
    return { status: "success", value: result.queuedCount > 0 ? "queued" : "back" };
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
        ? `suggest cleanup after ${draft.cleanupPolicy.graceDays} days watched`
        : "keep last watched episode local";
    const episodeCodes = episodes
      .map(
        (episode) =>
          `S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}`,
      )
      .join(", ");
    const profileDetail = [
      `${draft.audioPreference} audio`,
      `${draft.subtitlePreference} subtitles`,
      draft.qualityPreference ? `${draft.qualityPreference} quality` : "highest available quality",
      draft.cacheArtwork
        ? title.posterUrl
          ? "poster saved with download"
          : "artwork caching on (no poster yet)"
        : "no artwork saved",
      `destination: ${target}`,
      cleanup,
      "disk space checked before queueing",
      "provider resolve happens only after you confirm",
    ]
      .filter(Boolean)
      .join(" · ");
    const selection = await chooseFromListShell<
      "queue" | "runway" | "back" | DownloadConfirmationEditAction
    >({
      title: `Download ${title.name}?`,
      subtitle: `${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"} · ${episodeCodes} · edits stay local until you queue`,
      actionContext: buildPickerActionContext({ container, taskLabel: `Download: ${title.name}` }),
      options: [
        // Primary action leads. Settings sit below; Cancel is last (Esc also backs out).
        { value: "queue", label: "Queue download", detail: profileDetail },
        ...(title.type !== "movie"
          ? [
              {
                value: "runway" as const,
                label: "Queue download + keep next episodes ready",
                detail: `${profileDetail} · offline runway keeps up to ${draft.runwayTarget ?? 1} released episodes ready`,
              },
            ]
          : []),
        {
          value: "cycle-quality",
          label: `Quality: ${draft.qualityPreference ?? "highest"}`,
          detail: "Cycle download quality — highest available unless you cap it",
        },
        {
          value: "cycle-subtitle",
          label: `Subtitles: ${draft.subtitlePreference}`,
          detail: "Cycle the subtitle language saved with downloads",
        },
        {
          value: "toggle-artwork",
          label: `Artwork: ${draft.cacheArtwork ? "saved" : "off"}`,
          detail: "Save the title poster alongside the video for the offline library",
        },
        ...(container.config.downloadPath.trim()
          ? [
              {
                value: "toggle-destination" as const,
                label: `Save to: ${target}`,
                detail: "Switch between your configured folder and the default library",
              },
            ]
          : []),
        ...(title.type !== "movie"
          ? [
              {
                value: "increase-runway" as const,
                label: `Keep ready ahead: ${draft.runwayTarget ?? 1} episode(s)`,
                detail: "Pre-download upcoming episodes so they are ready offline",
              },
              {
                value: "decrease-runway" as const,
                label: "Keep fewer ready ahead",
                detail: "Lower how many episodes are pre-downloaded",
              },
              {
                value: "toggle-cleanup" as const,
                label: `After watching: ${cleanup}`,
                detail: "Whether watched episodes are suggested for cleanup (never auto-deleted)",
              },
            ]
          : []),
        { value: "back", label: "Cancel", detail: "Close without downloading (or press Esc)" },
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
