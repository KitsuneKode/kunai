import type { EpisodeInfo, StreamInfo } from "@/domain/types";

export type RecentPlaybackStreamProvenance = "fresh" | "cache" | "prefetch" | "fallback";

export type RecentPlaybackStreamRecord = {
  readonly stream: StreamInfo;
  readonly selectedProviderId: string;
  readonly resolvedProviderId: string;
  readonly provenance: RecentPlaybackStreamProvenance;
};

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
