import { type ContinueHistoryRelease } from "@/domain/continuation/history-reconciliation";
import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
import {
  resolveContinueSourceAction,
  type ContinueSourcePreference,
} from "@/services/continuation/continuation-source";
import { projectContinuationSurface } from "@/services/continuation/continuation-surface-policy";
import { historyContentType, isFinished } from "@/services/continuation/history-progress";
import type {
  HistoryProgress,
  ReleaseProgressProjection,
} from "@/services/storage/storage-read-models";

export type RootHistorySelection = {
  titleId: string;
  entry: HistoryProgress;
  localJobId?: string;
  targetEpisode?: {
    season: number;
    episode: number;
    reason: "resume" | "new-episode" | "offline-ready";
  };
};

type HistoryResolver = (value: RootHistorySelection | null) => void;

let pendingResolver: HistoryResolver | null = null;

export function waitForRootHistorySelection(): Promise<RootHistorySelection | null> {
  return new Promise<RootHistorySelection | null>((resolve) => {
    pendingResolver = resolve;
  });
}

export function resolveRootHistorySelection(value: RootHistorySelection | null): void {
  const resolve = pendingResolver;
  pendingResolver = null;
  resolve?.(value);
}

export function hasPendingRootHistorySelection(): boolean {
  return pendingResolver !== null;
}

export function formatNewSinceEpisodeLabel(
  lastWatchedEpisode: number,
  nextEpisode: number,
): string | null {
  if (!Number.isFinite(lastWatchedEpisode) || !Number.isFinite(nextEpisode)) return null;
  if (nextEpisode <= lastWatchedEpisode) return null;
  const delta = nextEpisode - lastWatchedEpisode;
  if (delta === 1) return `new since E${lastWatchedEpisode}`;
  return `${delta} new since E${lastWatchedEpisode}`;
}

export function describeHistoryReturnLoopDetail(input: {
  readonly entry: HistoryProgress;
  readonly nextRelease?: ContinueHistoryRelease | null;
}): string {
  if (isFinished(input.entry) && input.nextRelease?.status === "unknown") {
    return "caught up · release unknown";
  }

  const nextRelease =
    input.nextRelease &&
    typeof input.nextRelease.season === "number" &&
    typeof input.nextRelease.episode === "number"
      ? {
          season: input.nextRelease.season,
          episode: input.nextRelease.episode,
          released: input.nextRelease.status === "released",
          availableAt: input.nextRelease.releaseAt ?? undefined,
        }
      : null;

  const surface = projectContinuationSurface({
    titleId: "history-row",
    entry: input.entry,
    nextRelease,
  });

  if (
    (surface.state === "next" || surface.state === "new-episodes") &&
    typeof surface.target?.episode === "number"
  ) {
    const previousEpisode =
      historyContentType(input.entry) === "series"
        ? (input.entry.episode ?? input.entry.absoluteEpisode ?? 1)
        : 0;
    const newSince =
      historyContentType(input.entry) === "series"
        ? formatNewSinceEpisodeLabel(previousEpisode, surface.target.episode)
        : null;
    return newSince ? `${newSince} · open next aired episode` : "new episode ready";
  }

  if (surface.state === "resume") {
    return "resume where you left off";
  }

  if (surface.state === "up-to-date" || surface.state === "upcoming") {
    if (input.nextRelease?.status === "upcoming" && input.nextRelease.releaseAt) {
      return `caught up · next airs ${formatShortReleaseDate(input.nextRelease.releaseAt)}`;
    }
    if (input.nextRelease?.status === "unknown") return "caught up · release unknown";
    return "caught up";
  }

  return "pick up from history";
}

function formatShortReleaseDate(releaseAt: string): string {
  const date = new Date(releaseAt);
  if (Number.isNaN(date.getTime())) return "later";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function buildRootHistorySelection(
  selection: RootHistorySelection,
  nextReleases: ReadonlyMap<string, ContinueHistoryRelease> | undefined,
  projections?: ReadonlyMap<string, ContinuationProjection>,
  options?: {
    readonly sourcePreference?: ContinueSourcePreference;
    readonly sourceOverride?: "local" | "stream";
  },
): RootHistorySelection {
  const projection = projections?.get(selection.titleId);
  const action = resolveContinueSourceAction(
    projection,
    options?.sourcePreference ?? "auto",
    options?.sourceOverride,
  );
  if (action?.kind === "play-local") {
    return {
      ...selection,
      targetEpisode: {
        season: action.season,
        episode: action.episode,
        reason: "offline-ready",
      },
      localJobId: action.jobId,
    };
  }
  if (action?.kind === "select-online" || action?.kind === "resume") {
    return {
      ...selection,
      targetEpisode: {
        season: action.season,
        episode: action.episode,
        reason: action.kind === "select-online" ? "new-episode" : "resume",
      },
    };
  }
  if (historyContentType(selection.entry) !== "series") return selection;
  const next = nextReleases?.get(selection.titleId) ?? null;
  const surface = projectContinuationSurface({
    titleId: selection.titleId,
    entry: selection.entry,
    nextRelease:
      next && typeof next.season === "number" && typeof next.episode === "number"
        ? {
            season: next.season,
            episode: next.episode,
            released: next.status === "released",
            availableAt: next.releaseAt ?? undefined,
          }
        : null,
  });
  if (
    (surface.state === "next" || surface.state === "new-episodes") &&
    typeof surface.target?.episode === "number"
  ) {
    return {
      ...selection,
      targetEpisode: {
        season: surface.target.season ?? selection.entry.season ?? 1,
        episode: surface.target.episode,
        reason: "new-episode",
      },
    };
  }
  return {
    ...selection,
    targetEpisode: {
      season: selection.entry.season ?? 1,
      episode: selection.entry.episode ?? selection.entry.absoluteEpisode ?? 1,
      reason: "resume",
    },
  };
}

export function releaseProgressToContinueHistoryRelease(
  projection: ReleaseProgressProjection | undefined,
): ContinueHistoryRelease | null {
  if (!projection) return null;
  if (projection.status === "new-episodes" && projection.newEpisodeCount > 0) {
    return {
      status: "released",
      releaseAt: projection.latestKnownReleaseAt ?? null,
      season: projection.anchorSeason ?? projection.latestAiredSeason,
      episode: projection.anchorEpisode + 1,
    };
  }
  return {
    status:
      projection.status === "upcoming"
        ? "upcoming"
        : projection.status === "caught-up"
          ? "caught-up"
          : "unknown",
    releaseAt: projection.nextAiringAt ?? null,
    season: projection.nextAiringSeason,
    episode: projection.nextAiringEpisode,
  };
}
