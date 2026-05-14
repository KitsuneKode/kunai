import type { EpisodeInfo } from "@/domain/types";
import type { AutoDownloadMode } from "@/services/persistence/ConfigService";

export type DownloadScope =
  | { readonly type: "current-episode" }
  | { readonly type: "next-episode" }
  | { readonly type: "next-n"; readonly count: number }
  | { readonly type: "current-season-remaining" }
  | {
      readonly type: "manual-selection";
      readonly episodes: readonly { readonly season: number; readonly episode: number }[];
    };

export function normalizeAutoDownloadNextCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(24, Math.trunc(count ?? 1)));
}

export function resolveAutoDownloadScope(input: {
  readonly mode: AutoDownloadMode;
  readonly nextCount?: number;
}): DownloadScope | null {
  if (input.mode === "off") return null;
  if (input.mode === "season") return { type: "current-season-remaining" };
  const count = normalizeAutoDownloadNextCount(input.nextCount);
  return count > 1 ? { type: "next-n", count } : { type: "next-episode" };
}

export function selectEpisodesForDownloadScope(input: {
  readonly scope: DownloadScope;
  readonly currentEpisode: EpisodeInfo;
  readonly nextEpisode?: EpisodeInfo | null;
  readonly seasonEpisodes?: readonly EpisodeInfo[] | null;
}): readonly EpisodeInfo[] {
  if (input.scope.type === "current-episode") return [input.currentEpisode];
  if (input.scope.type === "next-episode") return input.nextEpisode ? [input.nextEpisode] : [];
  if (input.scope.type === "current-season-remaining") {
    return remainingSeasonEpisodes(input.currentEpisode, input.seasonEpisodes);
  }
  if (input.scope.type === "next-n") {
    const remaining = remainingSeasonEpisodes(input.currentEpisode, input.seasonEpisodes);
    if (remaining.length > 0) return remaining.slice(0, input.scope.count);
    return input.nextEpisode ? [input.nextEpisode].slice(0, input.scope.count) : [];
  }
  return dedupeManualSelection(input.scope.episodes).map((episode) => ({
    season: episode.season,
    episode: episode.episode,
  }));
}

function remainingSeasonEpisodes(
  currentEpisode: EpisodeInfo,
  seasonEpisodes: readonly EpisodeInfo[] | null | undefined,
): readonly EpisodeInfo[] {
  return (seasonEpisodes ?? [])
    .filter(
      (candidate) =>
        candidate.season === currentEpisode.season && candidate.episode > currentEpisode.episode,
    )
    .sort((a, b) => a.episode - b.episode);
}

function dedupeManualSelection(
  episodes: readonly { readonly season: number; readonly episode: number }[],
): readonly { readonly season: number; readonly episode: number }[] {
  const seen = new Set<string>();
  const deduped: { season: number; episode: number }[] = [];
  for (const episode of episodes) {
    const key = `${episode.season}:${episode.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(episode);
  }
  return deduped;
}
