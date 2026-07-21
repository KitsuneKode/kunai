// =============================================================================
// continuation-surface-policy.ts — one conservative Continue/History projection
//
// Startup Continue, History tabs/actions, and post-play must agree. Without
// authoritative release evidence a finished title is up to date / completed —
// never an optimistic fabricated E+1.
// =============================================================================

import type { CatalogEpisodeBounds } from "@/domain/continuation/catalog-episode-bounds";
import {
  classifyHistoryBucket,
  type HistoryReleaseSignal,
} from "@/domain/continuation/history-bucket";
import type { HistoryProgress } from "@kunai/storage";
import type { EpisodeIdentity } from "@kunai/types";

import {
  projectContinuation,
  type ContinuationNextRelease,
  type OfflineEpisodeRef,
} from "./continuation-engine";

export type ContinuationSurfaceState =
  | "resume"
  | "next"
  | "new-episodes"
  | "upcoming"
  | "up-to-date"
  | "empty";

export type ContinuationSurfaceDecision = {
  readonly state: ContinuationSurfaceState;
  readonly historyBucket: "continue" | "new-episodes" | "completed";
  readonly actionLabel: "Continue" | "Play next" | "Play local" | "Open";
  readonly target?: EpisodeIdentity;
};

export type ContinuationSurfaceInput = {
  readonly titleId: string;
  readonly entry: HistoryProgress | null;
  readonly nextRelease?: ContinuationNextRelease | null;
  readonly releaseProgress?: { readonly newEpisodeCount: number; readonly stale?: boolean } | null;
  readonly offline?: {
    readonly enrolled: boolean;
    readonly readyNextEpisodes: readonly OfflineEpisodeRef[];
  } | null;
  readonly releaseSignal?: HistoryReleaseSignal | null;
  readonly catalogBounds?: CatalogEpisodeBounds | null;
};

/**
 * Single user-visible continuation projection shared by Continue and History.
 */
export function projectContinuationSurface(
  input: ContinuationSurfaceInput,
): ContinuationSurfaceDecision {
  const { entry } = input;
  if (!entry) {
    return { state: "empty", historyBucket: "completed", actionLabel: "Open" };
  }

  // History maps may key rows by catalog id while `entry.titleId` differs
  // (native/provider id). Project under the lookup key so the engine does not
  // drop the only supplied row and empty the Continue/History surface.
  const engine = projectContinuation({
    titleId: input.titleId,
    rows: [{ ...entry, titleId: input.titleId }],
    nextRelease: input.nextRelease,
    releaseProgress: input.releaseProgress,
    offline: input.offline,
  });

  const hasKnownNextToPlay =
    engine.state === "offline-ready" ||
    engine.state === "next-up" ||
    (engine.state === "new-episodes" &&
      typeof engine.season === "number" &&
      typeof engine.episode === "number");

  const historyBucket = classifyHistoryBucket({
    entry,
    release: input.releaseSignal ?? null,
    hasKnownNextToPlay,
    catalogBounds: input.catalogBounds ?? null,
  });

  const target = episodeTarget(engine.season, engine.episode, entry);

  if (engine.state === "resume") {
    return {
      state: "resume",
      historyBucket: "continue",
      actionLabel: "Continue",
      target,
    };
  }

  if (engine.state === "offline-ready") {
    return {
      state: "next",
      historyBucket: "continue",
      actionLabel: "Play local",
      target,
    };
  }

  if (engine.state === "new-episodes") {
    return {
      state: historyBucket === "new-episodes" ? "new-episodes" : "next",
      historyBucket,
      actionLabel: typeof engine.episode === "number" ? "Play next" : "Open",
      target: typeof engine.episode === "number" ? target : undefined,
    };
  }

  if (engine.state === "next-up") {
    return {
      state: historyBucket === "new-episodes" ? "new-episodes" : "next",
      historyBucket,
      actionLabel: "Play next",
      target,
    };
  }

  if (engine.state === "airing-weekly") {
    return {
      state: "upcoming",
      historyBucket: "completed",
      actionLabel: "Open",
      target,
    };
  }

  // up-to-date / new-season / anything else — still honor release-backed buckets
  // (fresh new-episodes / aired backlog) even when the engine lacks a concrete target.
  if (historyBucket === "new-episodes") {
    return {
      state: "new-episodes",
      historyBucket,
      actionLabel: typeof engine.episode === "number" ? "Play next" : "Open",
      target: typeof engine.episode === "number" ? target : undefined,
    };
  }

  if (historyBucket === "continue" && hasKnownNextToPlay) {
    return {
      state: "next",
      historyBucket,
      actionLabel: "Play next",
      target,
    };
  }

  return {
    state: "up-to-date",
    historyBucket,
    actionLabel: "Open",
  };
}

function episodeTarget(
  season: number | undefined,
  episode: number | undefined,
  entry: HistoryProgress,
): EpisodeIdentity | undefined {
  const resolvedSeason = season ?? entry.season;
  const resolvedEpisode = episode ?? entry.episode ?? entry.absoluteEpisode;
  if (typeof resolvedSeason !== "number" && typeof resolvedEpisode !== "number") {
    return undefined;
  }
  return {
    ...(typeof resolvedSeason === "number" ? { season: resolvedSeason } : {}),
    ...(typeof resolvedEpisode === "number" ? { episode: resolvedEpisode } : {}),
    ...(typeof entry.absoluteEpisode === "number" && episode === undefined
      ? { absoluteEpisode: entry.absoluteEpisode }
      : {}),
  };
}
