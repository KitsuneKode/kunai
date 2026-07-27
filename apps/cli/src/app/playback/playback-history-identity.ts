import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import type { EpisodeIdentity } from "@kunai/types";

/**
 * Build the one episode identity used by both history checkpoints and the final
 * playback save. Keeping this shared prevents anime absolute episode numbers
 * from disappearing when the ledger, rather than the fallback upsert, persists
 * the row.
 */
export function episodeIdentityForHistory(
  title: Pick<TitleInfo, "type">,
  episode: Pick<EpisodeInfo, "season" | "episode" | "absoluteEpisode">,
): EpisodeIdentity | undefined {
  if (title.type !== "series") return undefined;

  return {
    season: episode.season,
    episode: episode.episode,
    ...(episode.absoluteEpisode !== undefined ? { absoluteEpisode: episode.absoluteEpisode } : {}),
  };
}
