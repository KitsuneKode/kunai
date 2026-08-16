import { forceCloseRootContent } from "@/app-shell/root-content-state";
import type { BrowseShellResult } from "@/app-shell/types";
import type { Container } from "@/container";
import type { EpisodeInfo, SearchResult, TitleInfo } from "@/domain/types";
import type { DownloadJobRecord } from "@kunai/storage";

export type OfflinePlaybackLaunch = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
};

export type OfflinePlaybackRequestResult =
  | { readonly status: "browse-handoff"; readonly launch: OfflinePlaybackLaunch }
  | { readonly status: "direct"; readonly launch: OfflinePlaybackLaunch };

export type OfflinePlaybackRequestOptions = {
  /** Called synchronously before overlay close when no retained browse session owns the launch. */
  readonly onDirectLaunch?: (launch: OfflinePlaybackLaunch) => void;
};

export function titleInfoFromDownloadJob(job: DownloadJobRecord): TitleInfo {
  return {
    id: job.titleId,
    type:
      job.contentType ??
      (job.mediaKind === "movie" || job.mediaKind === "video" ? "movie" : "series"),
    name: job.titleName,
    posterUrl: job.posterUrl,
    isAnime: job.mediaKind === "anime" || job.mode === "anime",
    launchSource: "offline-library",
  };
}

export function episodeInfoFromDownloadJob(job: DownloadJobRecord): EpisodeInfo | undefined {
  if (job.contentType === "movie" || job.mediaKind === "movie") return undefined;
  if (job.season === undefined && job.episode === undefined) return undefined;
  return {
    season: job.season ?? 1,
    episode: job.episode ?? 1,
  };
}

function applyDownloadJobSessionRouting(container: Container, job: DownloadJobRecord): void {
  const mode =
    job.mode === "youtube" || job.mediaKind === "video"
      ? "youtube"
      : job.mode === "anime" || job.mediaKind === "anime"
        ? "anime"
        : "series";
  const state = container.stateManager.getState();
  container.stateManager.dispatch({
    type: "SET_MODE",
    mode,
    provider: job.providerId ?? state.defaultProviders?.[mode] ?? state.provider,
  });
}

export function buildOfflinePlaybackLaunch(job: DownloadJobRecord): OfflinePlaybackLaunch {
  return {
    title: titleInfoFromDownloadJob(job),
    episode: episodeInfoFromDownloadJob(job),
  };
}

export function applyOfflinePlaybackLaunch(
  container: Container,
  job: DownloadJobRecord,
  launch: OfflinePlaybackLaunch,
): void {
  applyDownloadJobSessionRouting(container, job);
  container.stateManager.dispatch({ type: "SELECT_TITLE", title: launch.title });
  if (launch.episode) {
    container.stateManager.dispatch({ type: "SELECT_EPISODE", episode: launch.episode });
  }
}

export async function prepareOfflinePlaybackLaunch(
  container: Container,
  jobId: string,
): Promise<OfflinePlaybackLaunch | null> {
  const playable = await container.offlineLibraryService.getPlayableSource(jobId);
  if (playable.status !== "ready") {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Offline file unavailable (${playable.status}). Try integrity check.`,
    });
    return null;
  }

  const launch = buildOfflinePlaybackLaunch(playable.job);
  applyOfflinePlaybackLaunch(container, playable.job, launch);
  return launch;
}

/**
 * Start unified offline playback from a shell overlay while browse may still be mounted.
 * Closes the overlay, interrupts browse when mounted, and returns an explicit handoff.
 */
export async function requestUnifiedOfflinePlayback(
  container: Container,
  jobId: string,
  options: OfflinePlaybackRequestOptions = {},
): Promise<OfflinePlaybackRequestResult | null> {
  const launch = await prepareOfflinePlaybackLaunch(container, jobId);
  if (!launch) return null;

  const closedBrowse = forceCloseRootContent<BrowseShellResult<SearchResult>>({
    type: "launch-playback",
    launch,
  });

  if (!closedBrowse) {
    options.onDirectLaunch?.(launch);
  }

  container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });

  if (closedBrowse) {
    return { status: "browse-handoff", launch };
  }

  return { status: "direct", launch };
}
