import { resumeSecondsFromProgressPoint } from "@/domain/playback/playback-progress-policy";
import type { EpisodeInfo } from "@/domain/types";
import { isFinished } from "@/services/continuation/history-progress";
import type { HistoryRepository, HistoryTitleLookup } from "@kunai/storage";
import type { EpisodeIdentity } from "@kunai/types";

/**
 * Seconds to resume at for a specific episode from SQLite history, or 0 when we should
 * start from the beginning (no row, explicitly finished, or too short).
 *
 * Uses exact episode identity only — never inherits a sibling episode's position.
 */
export function resumeSecondsFromHistoryForEpisode(
  historyRepository: HistoryRepository,
  title: HistoryTitleLookup,
  episode: EpisodeInfo,
): number {
  for (const episodeIdentity of candidateResumeEpisodeIdentities(episode)) {
    const entry = historyRepository.getProgressForTitleIdentity(title, episodeIdentity);
    if (!entry) continue;
    if (isFinished(entry)) return 0;

    return resumeSecondsFromProgressPoint({
      positionSeconds: entry.positionSeconds,
      durationSeconds: entry.durationSeconds ?? 0,
    });
  }
  return 0;
}

/**
 * Exact episode keys to try for resume. Absolute-only rows (`none:none:abs`) are tried
 * when `absoluteEpisode` is present; season/episode lookups never fall back across a
 * different SxE number.
 */
export function candidateResumeEpisodeIdentities(episode: EpisodeInfo): readonly EpisodeIdentity[] {
  const identities: EpisodeIdentity[] = [];
  const seen = new Set<string>();
  const add = (identity: EpisodeIdentity) => {
    const key = `${identity.season ?? "n"}:${identity.episode ?? "n"}:${identity.absoluteEpisode ?? "n"}`;
    if (seen.has(key)) return;
    seen.add(key);
    identities.push(identity);
  };

  if (episode.absoluteEpisode !== undefined) {
    add({
      season: episode.season,
      episode: episode.episode,
      absoluteEpisode: episode.absoluteEpisode,
    });
    add({ absoluteEpisode: episode.absoluteEpisode });
  }
  add({ season: episode.season, episode: episode.episode });
  return identities;
}
