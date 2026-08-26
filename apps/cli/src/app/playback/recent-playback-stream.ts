import {
  isStreamTimestampFresh,
  MAX_IN_MEMORY_STREAM_REPLAY_AGE_MS,
} from "@/domain/playback/in-memory-stream-replay-policy";
import type { EpisodeInfo, StreamInfo } from "@/domain/types";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";
import { encodeProviderEpisodeIdentity, providerEpisodeIdentitiesEqual } from "@kunai/types";

export { MAX_IN_MEMORY_STREAM_REPLAY_AGE_MS, isStreamTimestampFresh };

export type RecentPlaybackStreamProvenance = "fresh" | "cache" | "prefetch" | "fallback" | "local";

type RecentPlaybackStreamBase = {
  readonly stream: StreamInfo;
  readonly episode: EpisodeInfo;
  readonly selectedProviderId: string;
  readonly resolvedProviderId: string;
};

export type RecentPlaybackStreamRecord =
  | (RecentPlaybackStreamBase & {
      readonly provenance: "local";
      readonly localPlaybackSource: LocalPlaybackSource;
    })
  | (RecentPlaybackStreamBase & {
      readonly provenance: Exclude<RecentPlaybackStreamProvenance, "local">;
      readonly localPlaybackSource?: never;
    });

export function restoreRecentPlaybackStream(recent: RecentPlaybackStreamRecord): {
  readonly stream: StreamInfo;
  readonly resolvedProviderId: string;
  readonly provenance: RecentPlaybackStreamProvenance;
  readonly localPlaybackSource: LocalPlaybackSource | null;
} {
  return {
    stream: recent.stream,
    resolvedProviderId: recent.resolvedProviderId,
    provenance: recent.provenance,
    localPlaybackSource: recent.provenance === "local" ? recent.localPlaybackSource : null,
  };
}

export function recentPlaybackStreamKey(titleId: string, episode: EpisodeInfo): string {
  const providerIdentity = episode.providerEpisodeIdentity
    ? `:${encodeProviderEpisodeIdentity(episode.providerEpisodeIdentity)}`
    : "";
  return `${titleId}:${episode.season}:${episode.episode}${providerIdentity}`;
}

export function recentPlaybackStreamMatchesProvider(
  recent: RecentPlaybackStreamRecord | undefined,
  effectiveProviderId: string,
  requestedEpisode: EpisodeInfo,
): recent is RecentPlaybackStreamRecord {
  if (!recent) return false;
  if (
    recent.episode.season !== requestedEpisode.season ||
    recent.episode.episode !== requestedEpisode.episode ||
    !providerEpisodeIdentitiesEqual(
      recent.episode.providerEpisodeIdentity,
      requestedEpisode.providerEpisodeIdentity,
    )
  ) {
    return false;
  }
  if (recent.resolvedProviderId !== effectiveProviderId) return false;
  return recent.selectedProviderId === effectiveProviderId || recent.provenance === "fallback";
}

export function isRecentPlaybackStreamFresh(
  record: RecentPlaybackStreamRecord,
  now: number = Date.now(),
): boolean {
  if (record.provenance === "local") return true;
  return isStreamTimestampFresh(record.stream, now);
}
