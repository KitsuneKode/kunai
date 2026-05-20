import type { EpisodeInfo } from "@/domain/types";

export type EpisodeQueueScope =
  | { readonly type: "current-episode" }
  | { readonly type: "next-episode" }
  | { readonly type: "next-n"; readonly count: number }
  | { readonly type: "current-season-remaining" }
  | {
      readonly type: "manual-selection";
      readonly episodes: readonly { readonly season: number; readonly episode: number }[];
    };

export type EpisodeQueuePlanReason =
  | "current-episode"
  | "explicit-next"
  | "current-season-window"
  | "manual-selection"
  | "empty";

export type EpisodeQueuePlan = {
  readonly episodes: readonly EpisodeInfo[];
  readonly reason: EpisodeQueuePlanReason;
};

export type MediaQueuePlacement = "next" | "after-current-chain" | "end";

export function planMediaQueuePlacement(placement: MediaQueuePlacement): {
  readonly priority: number;
  readonly bucket: MediaQueuePlacement;
} {
  if (placement === "next") return { priority: 100, bucket: placement };
  if (placement === "after-current-chain") return { priority: 50, bucket: placement };
  return { priority: 0, bucket: placement };
}

export function planEpisodeQueue(input: {
  readonly scope: EpisodeQueueScope;
  readonly currentEpisode: EpisodeInfo;
  readonly nextEpisode?: EpisodeInfo | null;
  readonly seasonEpisodes?: readonly EpisodeInfo[] | null;
}): EpisodeQueuePlan {
  const { scope } = input;
  if (scope.type === "current-episode") {
    return { episodes: [input.currentEpisode], reason: "current-episode" };
  }

  if (scope.type === "next-episode") {
    return input.nextEpisode
      ? { episodes: [input.nextEpisode], reason: "explicit-next" }
      : { episodes: [], reason: "empty" };
  }

  if (scope.type === "current-season-remaining") {
    const episodes = remainingSeasonEpisodes(input.currentEpisode, input.seasonEpisodes);
    return {
      episodes,
      reason: episodes.length > 0 ? "current-season-window" : "empty",
    };
  }

  if (scope.type === "next-n") {
    const remaining = remainingSeasonEpisodes(input.currentEpisode, input.seasonEpisodes);
    if (remaining.length > 0) {
      return {
        episodes: remaining.slice(0, scope.count),
        reason: "current-season-window",
      };
    }
    return input.nextEpisode
      ? { episodes: [input.nextEpisode].slice(0, scope.count), reason: "explicit-next" }
      : { episodes: [], reason: "empty" };
  }

  return {
    episodes: dedupeEpisodeRefs(scope.episodes).map((episode) => ({
      season: episode.season,
      episode: episode.episode,
    })),
    reason: "manual-selection",
  };
}

function remainingSeasonEpisodes(
  currentEpisode: EpisodeInfo,
  seasonEpisodes: readonly EpisodeInfo[] | null | undefined,
): readonly EpisodeInfo[] {
  const seen = new Set<string>();
  const out: EpisodeInfo[] = [];
  for (const candidate of seasonEpisodes ?? []) {
    if (candidate.season !== currentEpisode.season) continue;
    if (candidate.episode <= currentEpisode.episode) continue;
    const key = `${candidate.season}:${candidate.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out.sort((a, b) => a.episode - b.episode);
}

function dedupeEpisodeRefs(
  episodes: readonly { readonly season: number; readonly episode: number }[],
): readonly { readonly season: number; readonly episode: number }[] {
  const seen = new Set<string>();
  const out: { season: number; episode: number }[] = [];
  for (const episode of episodes) {
    const key = `${episode.season}:${episode.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ season: episode.season, episode: episode.episode });
  }
  return out;
}
