import { openDownloadConfirmationShell } from "@/app-shell/download-confirmation-shell";
import { pickEpisodesToDownload } from "@/app/bootstrap/download-episode-checklist";
import type { Phase, PhaseContext, PhaseResult } from "@/app/session/Phase";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
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
    readonly container: PhaseContext["container"];
  }) => Promise<readonly EpisodeInfo[] | null>;
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
    const isTitleLevel = mediaKind === "movie" || mediaKind === "video";
    let items: readonly DownloadIntentItem[];

    if (isTitleLevel) {
      items = [{ kind: "title" }];
    } else {
      let episodes = this.deps.pickEpisodes
        ? await this.deps.pickEpisodes({ title: input.title, isAnime, container })
        : await pickEpisodesToDownload({
            title: input.title,
            isAnime,
            animeEpisodes: undefined,
            container,
          });

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
