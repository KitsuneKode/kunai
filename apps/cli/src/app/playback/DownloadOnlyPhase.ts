import { openDownloadConfirmationShell } from "@/app-shell/download-confirmation-shell";
import { pickEpisodesToDownload } from "@/app/bootstrap/download-episode-checklist";
import type { Phase, PhaseContext, PhaseResult } from "@/app/session/Phase";
import { isTitleLevelContent } from "@/domain/media/content-kind";
import type { EpisodeInfo, EpisodePickerOption, TitleInfo } from "@/domain/types";
import {
  buildDefaultDownloadProfile,
  commitDownloadIntent,
  type DownloadConfirmationProfile,
  type DownloadIntentItem,
} from "@/services/download/DownloadIntentService";
import { chooseStartingEpisode } from "@/session-flow";
import type { MediaKind } from "@kunai/types";

export type DownloadOnlyInput = {
  readonly title: TitleInfo;
  readonly outputDirectory?: string;
};

type DownloadOnlyPhaseDependencies = {
  readonly pickEpisodes?: (args: {
    readonly title: TitleInfo;
    readonly isAnime: boolean;
    readonly animeEpisodes: readonly EpisodePickerOption[] | undefined;
    readonly container: PhaseContext["container"];
  }) => Promise<readonly EpisodeInfo[] | null>;
  readonly loadAnimeEpisodes?: (args: {
    readonly title: TitleInfo;
    readonly container: PhaseContext["container"];
    readonly signal: AbortSignal;
  }) => Promise<readonly EpisodePickerOption[] | null | undefined>;
  readonly confirmProfile?: (args: {
    readonly title: TitleInfo;
    readonly mediaKind: MediaKind;
    readonly items: readonly DownloadIntentItem[];
    readonly profile: DownloadConfirmationProfile;
    readonly container: PhaseContext["container"];
  }) => Promise<DownloadConfirmationProfile | null>;
  readonly prepareConfirmedTitle?: (title: TitleInfo, context: PhaseContext) => Promise<TitleInfo>;
};

/**
 * The one derivation of a download's content kind from playback facts, matching
 * what `DownloadService.enqueue()` persists. YouTube playback is a video,
 * anime mode is anime, and otherwise the title's own shape decides.
 */
function resolveDownloadOnlyMediaKind(mode: string | undefined, title: TitleInfo): MediaKind {
  if (mode === "youtube") return "video";
  if (mode === "anime") return "anime";
  return title.type === "movie" ? "movie" : "series";
}

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
    // One canonical content kind, derived from playback facts. A movie or a
    // YouTube video has nothing to pick, so it never reaches the episode
    // checklist or its first-episode fallback.
    const mediaKind = resolveDownloadOnlyMediaKind(state.mode, input.title);
    const isTitleLevel = isTitleLevelContent(mediaKind, input.title.type);
    let items: readonly DownloadIntentItem[];

    if (isTitleLevel) {
      items = [{ kind: "title" }];
    } else {
      const shouldLoadAnimeEpisodes =
        isAnime && (!this.deps.pickEpisodes || this.deps.loadAnimeEpisodes !== undefined);
      const animeEpisodes = shouldLoadAnimeEpisodes
        ? await (this.deps.loadAnimeEpisodes ?? loadProductionAnimeEpisodes)({
            title: input.title,
            container,
            signal: context.signal,
          })
        : undefined;
      if (shouldLoadAnimeEpisodes && animeEpisodes === null) {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: "Anime episode catalog is temporarily unavailable. Try again.",
        });
        return { status: "success", value: "back" };
      }
      if (shouldLoadAnimeEpisodes && animeEpisodes?.length === 0) {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: "No downloadable episodes were found for this anime.",
        });
        return { status: "success", value: "back" };
      }
      const selectableAnimeEpisodes = animeEpisodes ?? undefined;
      let episodes = this.deps.pickEpisodes
        ? await this.deps.pickEpisodes({
            title: input.title,
            isAnime,
            animeEpisodes: selectableAnimeEpisodes,
            container,
          })
        : await pickEpisodesToDownload({
            title: input.title,
            isAnime,
            animeEpisodes: selectableAnimeEpisodes,
            container,
          });

      if (!episodes || episodes.length === 0) {
        if (selectableAnimeEpisodes !== undefined) {
          return { status: "success", value: "back" };
        }
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

      items = episodes.map((episode) => ({ kind: "episode" as const, episode }));
    }

    const proposedProfile = buildDefaultDownloadProfile(container, {
      outputDirectory: input.outputDirectory,
    });
    const profile = this.deps.confirmProfile
      ? await this.deps.confirmProfile({
          title: input.title,
          mediaKind,
          items,
          profile: proposedProfile,
          container,
        })
      : await openDownloadConfirmationShell({
          title: input.title,
          mediaKind,
          items,
          initialProfile: proposedProfile,
          container,
        });
    if (!profile) return { status: "success", value: "back" };
    const confirmedTitle = this.deps.prepareConfirmedTitle
      ? await this.deps.prepareConfirmedTitle(input.title, context)
      : input.title;

    const result = await commitDownloadIntent(container, {
      title: confirmedTitle,
      mediaKind,
      items,
      profile,
    });
    return { status: "success", value: result.queuedCount > 0 ? "queued" : "back" };
  }
}

async function loadProductionAnimeEpisodes({
  title,
  container,
  signal,
}: {
  readonly title: TitleInfo;
  readonly container: PhaseContext["container"];
  readonly signal: AbortSignal;
}): Promise<readonly EpisodePickerOption[] | null | undefined> {
  const state = container.stateManager.getState();
  const provider = container.providerRegistry.get(state.provider);
  if (!provider) return null;
  if (!provider.listEpisodes) return undefined;
  try {
    return await provider.listEpisodes(
      {
        title,
        audioPreference: state.animeLanguageProfile.audio,
        subtitlePreference: state.animeLanguageProfile.subtitle,
      },
      signal,
    );
  } catch {
    return null;
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
  const selected = await chooseStartingEpisode({
    currentId: title.id,
    isAnime,
    animeEpisodeCount: title.episodeCount,
    animeEpisodes: undefined,
    flags: {},
    getHistoryEntry: () =>
      Promise.resolve(
        container.historyRepository.getLatestForTitleIdentity({
          id: title.id,
          kind: isAnime ? "anime" : title.type === "movie" ? "movie" : "series",
          externalIds: title.externalIds,
        }) ?? null,
      ),
    container,
  });
  if (selected.kind === "unavailable") {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: selected.reason,
    });
    return null;
  }
  if (selected.kind !== "selected") return null;
  return { season: selected.selection.season, episode: selected.selection.episode };
}
