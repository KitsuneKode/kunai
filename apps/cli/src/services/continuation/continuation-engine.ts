// =============================================================================
// continuation-engine.ts — pure continuation decision (Netflix anchor rule)
//
// Anchors on the MOST-RECENT episode for a title: resume it if unfinished,
// otherwise advance. Never scans back to an older abandoned episode.
// =============================================================================

import type { HistoryProgress } from "@kunai/storage";

import { isFinished } from "./history-progress";

export type ContinuationStateKind =
  | "resume"
  | "next-up"
  | "new-episodes"
  | "new-season"
  | "airing-weekly"
  | "up-to-date"
  | "offline-ready"
  | "empty";

export type ContinuationNextRelease = {
  readonly season: number;
  readonly episode: number;
  readonly released: boolean;
  readonly availableAt?: string;
};

export type NewSeasonSignal = {
  readonly season: number;
  readonly availableAt?: string;
};

export type OfflineEpisodeRef = {
  readonly season: number;
  readonly episode: number;
  readonly jobId?: string;
};

export type ContinuationDecision = {
  readonly state: ContinuationStateKind;
  readonly titleId: string;
  readonly title?: string;
  readonly season?: number;
  readonly episode?: number;
  readonly positionSeconds?: number;
  readonly jobId?: string;
  readonly newEpisodeCount?: number;
  readonly availableAt?: string;
  /** The most-recent (anchor) row the decision was made from, when one exists. */
  readonly anchor?: HistoryProgress;
};

export type ProjectContinuationInput = {
  readonly titleId: string;
  readonly rows: readonly HistoryProgress[];
  readonly nextRelease?: ContinuationNextRelease | null;
  readonly newSeason?: NewSeasonSignal | null;
  readonly offline?: {
    readonly enrolled: boolean;
    readonly readyNextEpisodes: readonly OfflineEpisodeRef[];
  } | null;
  readonly releaseProgress?: { readonly newEpisodeCount: number; readonly stale?: boolean } | null;
};

/**
 * Pure continuation decision. Anchors on the MOST-RECENT episode for the title
 * (Netflix/Crunchyroll rule): resume it if unfinished, otherwise advance. Never
 * scans back to an older abandoned episode.
 */
export function projectContinuation(input: ProjectContinuationInput): ContinuationDecision {
  const rows = input.rows
    .filter((row) => row.titleId === input.titleId)
    .slice()
    .sort(byUpdatedAtDesc);
  const anchor = rows[0];
  if (!anchor) return { state: "empty", titleId: input.titleId };

  if (!isFinished(anchor)) {
    return {
      state: "resume",
      titleId: input.titleId,
      title: anchor.title,
      season: anchor.season,
      episode: anchor.episode,
      positionSeconds: anchor.positionSeconds,
      anchor,
    };
  }

  const localNext = (input.offline?.readyNextEpisodes ?? [])
    .filter((episode) => isEpisodeAfterAnchor(episode, anchor))
    .sort((left, right) => left.season - right.season || left.episode - right.episode)[0];
  if (localNext) {
    return {
      state: "offline-ready",
      titleId: input.titleId,
      title: anchor.title,
      season: localNext.season,
      episode: localNext.episode,
      jobId: localNext.jobId,
      anchor,
    };
  }

  if (input.releaseProgress && input.releaseProgress.newEpisodeCount > 0) {
    return {
      state: "new-episodes",
      titleId: input.titleId,
      title: anchor.title,
      season: input.nextRelease?.released ? input.nextRelease.season : undefined,
      episode: input.nextRelease?.released ? input.nextRelease.episode : undefined,
      newEpisodeCount: input.releaseProgress.newEpisodeCount,
      anchor,
    };
  }

  if (input.newSeason) {
    return {
      state: "new-season",
      titleId: input.titleId,
      title: anchor.title,
      season: input.newSeason.season,
      availableAt: input.newSeason.availableAt,
      anchor,
    };
  }

  if (input.nextRelease?.released) {
    return {
      state: "next-up",
      titleId: input.titleId,
      title: anchor.title,
      season: input.nextRelease.season,
      episode: input.nextRelease.episode,
      anchor,
    };
  }

  if (input.nextRelease) {
    return {
      state: "airing-weekly",
      titleId: input.titleId,
      title: anchor.title,
      season: input.nextRelease.season,
      episode: input.nextRelease.episode,
      availableAt: input.nextRelease.availableAt,
      anchor,
    };
  }

  return { state: "up-to-date", titleId: input.titleId, title: anchor.title, anchor };
}

/** One most-recent row per titleId, ordered newest-first by updatedAt. */
export function groupLatestByTitle(rows: readonly HistoryProgress[]): HistoryProgress[] {
  const latest = new Map<string, HistoryProgress>();
  for (const row of rows) {
    const current = latest.get(row.titleId);
    if (!current || Date.parse(row.updatedAt) > Date.parse(current.updatedAt)) {
      latest.set(row.titleId, row);
    }
  }
  return [...latest.values()].sort(byUpdatedAtDesc);
}

function byUpdatedAtDesc(left: HistoryProgress, right: HistoryProgress): number {
  return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
}

function isEpisodeAfterAnchor(
  episode: { readonly season: number; readonly episode: number },
  anchor: HistoryProgress,
): boolean {
  const anchorSeason = anchor.season ?? 1;
  const anchorEpisode = anchor.episode ?? anchor.absoluteEpisode ?? 0;
  return (
    episode.season > anchorSeason ||
    (episode.season === anchorSeason && episode.episode > anchorEpisode)
  );
}
