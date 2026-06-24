import type { Container } from "@/container";
import { createSourceSelectionEngine } from "@/domain/playback-source/SourceSelectionEngine";
import type { PlaybackSourcePreference } from "@/domain/playback-source/SourceSelectionEngine";
import type { EpisodeInfo, PlaybackTimingMetadata, StreamInfo, TitleInfo } from "@/domain/types";
import type { ContinueSourcePreference } from "@/services/continuation/continuation-source";
import { isNetworkAvailable } from "@/services/network/network-availability";
import { findReadyJobIdForEpisode } from "@/services/offline/offline-episode-index";
import { parseIntroSkipTiming } from "@/services/offline/offline-library";

export type LocalEpisodePlaybackResolution = {
  readonly stream: StreamInfo;
  readonly jobId: string;
  readonly timing: PlaybackTimingMetadata | null;
};

export function mapContinuePreferenceToSourcePreference(
  preference: ContinueSourcePreference,
): PlaybackSourcePreference {
  if (preference === "local") return "prefer-local";
  if (preference === "stream") return "prefer-online";
  return "prefer-local";
}

export async function resolveLocalEpisodePlayback(
  container: Container,
  title: TitleInfo,
  episode: EpisodeInfo,
  options: {
    readonly entrypoint?: "online-search" | "continue";
    readonly forceOnline?: boolean;
    readonly forceLocal?: boolean;
  } = {},
): Promise<LocalEpisodePlaybackResolution | null> {
  if (options.forceOnline) return null;

  const jobId = findReadyJobIdForEpisode(
    container.offlineAssetService,
    title.id,
    episode.season,
    episode.episode,
  );
  if (!jobId) return null;

  const playable = await container.offlineLibraryService.getPlayableSource(jobId);
  if (options.forceLocal && playable.status === "ready") {
    return buildLocalEpisodeResolution(playable);
  }

  const localStatus =
    playable.status === "ready"
      ? ("ready" as const)
      : playable.status === "missing"
        ? ("missing-file" as const)
        : playable.status === "invalid-file"
          ? ("invalid-file" as const)
          : ("none" as const);

  const decision = createSourceSelectionEngine().decide({
    entrypoint: options.entrypoint ?? "online-search",
    local: { status: localStatus, jobId },
    networkAvailable: isNetworkAvailable(container),
    preference: mapContinuePreferenceToSourcePreference(container.config.continueSourcePreference),
  });

  if (decision.source !== "local" || playable.status !== "ready") return null;

  return buildLocalEpisodeResolution(playable);
}

function buildLocalEpisodeResolution(
  playable: Extract<
    Awaited<ReturnType<Container["offlineLibraryService"]["getPlayableSource"]>>,
    { status: "ready" }
  >,
): LocalEpisodePlaybackResolution {
  const displayTitle = formatOfflinePlaybackTitle(playable.source);
  return {
    jobId: playable.job.id,
    timing: playable.source.timing ?? parseIntroSkipTiming(playable.job.introSkipJson),
    stream: {
      url: playable.source.filePath,
      headers: {},
      subtitle: playable.source.subtitlePath,
      title: displayTitle,
      timestamp: Date.now(),
    },
  };
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
