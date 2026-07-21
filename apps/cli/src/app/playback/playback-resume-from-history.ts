import type { QuitNearEndThresholdMode } from "@/domain/playback/playback-policy";
import { resumeSecondsFromProgressPoint } from "@/domain/playback/playback-progress-policy";
import type { EpisodeInfo } from "@/domain/types";
import { isFinished } from "@/services/continuation/history-progress";
import type { HistoryRepository, HistoryTitleLookup } from "@kunai/storage";
import type { EpisodeIdentity } from "@kunai/types";

/**
 * Seconds to resume at for a specific episode from SQLite history, or 0 when we should
 * start from the beginning (no row, finished, too short, or near natural end).
 */
export function resolveBootstrapStartSeconds(input: {
  readonly sharedStartSeconds?: number;
  readonly historyResumeSeconds?: number;
}): number | undefined {
  const shared = input.sharedStartSeconds ?? 0;
  const history = input.historyResumeSeconds ?? 0;
  const best = Math.max(shared, history);
  return best > 0 ? best : undefined;
}

/**
 * Builds the per-episode resume resolver used by the first playback bootstrap.
 *
 * A shared share-link timestamp (`sharedStartSeconds`) wins over local history for the
 * FIRST episode that is resolved (via `max(shared, history)`), then is consumed so every
 * subsequent episode (auto-advance, manual navigation) falls back to plain history resume.
 * This keeps the shared timestamp a true one-shot bootstrap without persisting it.
 */
export function createBootstrapResumeResolver(input: {
  readonly sharedStartSeconds: number | undefined;
  readonly resumeFromHistory: (episode: EpisodeInfo) => number;
}): (episode: EpisodeInfo) => number {
  let applied = false;
  return (episode: EpisodeInfo): number => {
    const historyResume = input.resumeFromHistory(episode);
    if (!applied && input.sharedStartSeconds !== undefined) {
      applied = true;
      return (
        resolveBootstrapStartSeconds({
          sharedStartSeconds: input.sharedStartSeconds,
          historyResumeSeconds: historyResume > 0 ? historyResume : undefined,
        }) ?? historyResume
      );
    }
    return historyResume;
  };
}

/**
 * Seconds to resume at for a specific episode from SQLite history, or 0 when we should
 * start from the beginning (no row, finished, too short, or near natural end).
 *
 * Uses exact episode identity only — never inherits a sibling episode's position.
 */
export function resumeSecondsFromHistoryForEpisode(
  historyRepository: HistoryRepository,
  title: HistoryTitleLookup,
  episode: EpisodeInfo,
  quitNearEndThresholdMode: QuitNearEndThresholdMode,
): number {
  for (const episodeIdentity of candidateResumeEpisodeIdentities(episode)) {
    const entry = historyRepository.getProgressForTitleIdentity(title, episodeIdentity);
    if (!entry) continue;
    if (isFinished(entry)) return 0;

    return resumeSecondsFromProgressPoint(
      { positionSeconds: entry.positionSeconds, durationSeconds: entry.durationSeconds ?? 0 },
      quitNearEndThresholdMode,
    );
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
