import type { HistoryRepository } from "@kunai/storage";
import type { TitleIdentity } from "@kunai/types";

/** Mark every episode in a season from 1 through `throughEpisode` as watched. */
export function markSeasonThroughEpisode(
  repository: Pick<HistoryRepository, "markWatched">,
  title: TitleIdentity,
  season: number,
  throughEpisode: number,
): number {
  const last = Math.max(1, Math.trunc(throughEpisode));
  for (let episode = 1; episode <= last; episode++) {
    repository.markWatched(title, { season, episode });
  }
  return last;
}
