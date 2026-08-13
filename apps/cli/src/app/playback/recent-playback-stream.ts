import type { EpisodeInfo, StreamInfo } from "@/domain/types";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";

export type RecentPlaybackStreamProvenance = "fresh" | "cache" | "prefetch" | "fallback" | "local";

type RecentPlaybackStreamBase = {
  readonly stream: StreamInfo;
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
  return `${titleId}:${episode.season}:${episode.episode}`;
}

export function recentPlaybackStreamMatchesProvider(
  recent: RecentPlaybackStreamRecord | undefined,
  effectiveProviderId: string,
): recent is RecentPlaybackStreamRecord {
  if (!recent) return false;
  if (recent.resolvedProviderId !== effectiveProviderId) return false;
  return recent.selectedProviderId === effectiveProviderId || recent.provenance === "fallback";
}
