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

export function titleInfoFromDownloadJob(job: DownloadJobRecord): TitleInfo {
  return {
    id: job.titleId,
    type: job.mediaKind === "movie" ? "movie" : "series",
    name: job.titleName,
    posterUrl: job.posterUrl,
    isAnime: job.mediaKind === "anime" || job.mode === "anime",
  };
}

export function episodeInfoFromDownloadJob(job: DownloadJobRecord): EpisodeInfo | undefined {
  if (job.mediaKind === "movie") return undefined;
  if (job.season === undefined && job.episode === undefined) return undefined;
  return {
    season: job.season ?? 1,
    episode: job.episode ?? 1,
  };
}

function applyDownloadJobSessionRouting(container: Container, job: DownloadJobRecord): void {
  if (job.mode === "anime" || job.mediaKind === "anime") {
    container.stateManager.dispatch({
      type: "SET_MODE",
      mode: "anime",
      provider: job.providerId ?? container.stateManager.getState().provider,
    });
    return;
  }
  if (job.providerId) {
    container.stateManager.dispatch({
      type: "SET_PROVIDER",
      provider: job.providerId,
    });
  }
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
): Promise<OfflinePlaybackRequestResult | null> {
  const launch = await prepareOfflinePlaybackLaunch(container, jobId);
  if (!launch) return null;

  container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });

  const closedBrowse = forceCloseRootContent<BrowseShellResult<SearchResult>>({
    type: "offline-playback",
    launch,
  });

  if (closedBrowse) {
    return { status: "browse-handoff", launch };
  }

  return { status: "direct", launch };
}
