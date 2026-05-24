export type OfflineEpisodeRef = {
  readonly season: number;
  readonly episode: number;
};

export type OfflineRunwayExistingEpisode = OfflineEpisodeRef & {
  readonly state: "ready" | "queued" | "running" | "repairable";
};

export type OfflineRunwayPlan = {
  readonly target: number;
  readonly readyOrActiveCount: number;
  readonly deficit: number;
  readonly enqueue: readonly OfflineEpisodeRef[];
  readonly skipReason?:
    | "not-enrolled"
    | "no-watched-cursor"
    | "already-healthy"
    | "no-released-deficit"
    | "capacity-blocked";
};

export function planOfflineRunway(input: {
  readonly policy: { readonly enrolled: boolean; readonly target: number };
  readonly watchedCursor?: OfflineEpisodeRef;
  readonly existingEpisodes: readonly OfflineRunwayExistingEpisode[];
  readonly availableReleasedEpisodes: readonly OfflineEpisodeRef[];
  readonly storage: { readonly allowedNewAssets: number };
}): OfflineRunwayPlan {
  const target = Math.max(0, Math.trunc(input.policy.target));
  if (!input.policy.enrolled) {
    return { target, readyOrActiveCount: 0, deficit: 0, enqueue: [], skipReason: "not-enrolled" };
  }
  if (!input.watchedCursor) {
    return {
      target,
      readyOrActiveCount: 0,
      deficit: target,
      enqueue: [],
      skipReason: "no-watched-cursor",
    };
  }
  const watchedCursor = input.watchedCursor;

  const existing = new Set(
    input.existingEpisodes.map((episode) => episodeKey(episode.season, episode.episode)),
  );
  const readyOrActiveCount = input.existingEpisodes.filter((episode) =>
    isAfterCursor(episode, watchedCursor),
  ).length;
  const deficit = Math.max(0, target - readyOrActiveCount);
  if (deficit === 0) {
    return { target, readyOrActiveCount, deficit, enqueue: [], skipReason: "already-healthy" };
  }

  const eligible = dedupeEpisodes(input.availableReleasedEpisodes)
    .filter((episode) => isAfterCursor(episode, watchedCursor))
    .filter((episode) => !existing.has(episodeKey(episode.season, episode.episode)));
  if (eligible.length === 0) {
    return {
      target,
      readyOrActiveCount,
      deficit,
      enqueue: [],
      skipReason: "no-released-deficit",
    };
  }

  const capacity = Math.max(0, Math.trunc(input.storage.allowedNewAssets));
  if (capacity === 0) {
    return {
      target,
      readyOrActiveCount,
      deficit,
      enqueue: [],
      skipReason: "capacity-blocked",
    };
  }
  return {
    target,
    readyOrActiveCount,
    deficit,
    enqueue: eligible.slice(0, Math.min(deficit, capacity)),
  };
}

function isAfterCursor(episode: OfflineEpisodeRef, cursor: OfflineEpisodeRef): boolean {
  return (
    episode.season > cursor.season ||
    (episode.season === cursor.season && episode.episode > cursor.episode)
  );
}

function episodeKey(season: number, episode: number): string {
  return `${season}:${episode}`;
}

function dedupeEpisodes(episodes: readonly OfflineEpisodeRef[]): readonly OfflineEpisodeRef[] {
  const keyed = new Map<string, OfflineEpisodeRef>();
  for (const episode of episodes) keyed.set(episodeKey(episode.season, episode.episode), episode);
  return [...keyed.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
}
