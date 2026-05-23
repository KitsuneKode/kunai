import type { ReleaseProgressProjection } from "@kunai/storage";

import {
  planReleaseReconciliationCandidates,
  type ReleaseReconciliationCandidatePlan,
} from "./ReleaseReconciliationPlanner";
import type {
  ExistingReleaseProjection,
  ReleaseReconciliationCandidate,
  ReleaseReconciliationHistoryRow,
  ReleaseReconciliationSkip,
  ReleaseReconciliationTrigger,
} from "./types";

const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
const RETRY_BACKOFF_MS = [15, 30, 60, 120].map((minutes) => minutes * 60 * 1000);

export type CatalogProgressResult = {
  readonly candidate: ReleaseReconciliationCandidate;
  readonly latestAiredSeason?: number;
  readonly latestAiredEpisode?: number;
  readonly nextAiringSeason?: number;
  readonly nextAiringEpisode?: number;
  readonly nextAiringAt?: string;
  readonly latestKnownReleaseAt?: string;
  readonly sourceFingerprint: string;
};

export type ReleaseProgressRepositoryLike = {
  readonly getByTitleIds: (
    titleIds: readonly string[],
  ) => Map<string, ReleaseProgressProjection | ExistingReleaseProjection>;
  readonly upsert: (input: ReleaseProgressProjection) => void;
};

export type ReleaseReconciliationServiceOptions = {
  readonly repository: ReleaseProgressRepositoryLike;
  readonly loadProgress: (
    candidates: readonly ReleaseReconciliationCandidate[],
    signal?: AbortSignal,
  ) => Promise<readonly CatalogProgressResult[]>;
};

export type ReleaseReconciliationInput = {
  readonly trigger: ReleaseReconciliationTrigger;
  readonly now: string;
  readonly historyRows: readonly ReleaseReconciliationHistoryRow[];
  readonly mutedTitleIds?: ReadonlySet<string>;
  readonly signal?: AbortSignal;
};

export type ReleaseReconciliationResult = {
  readonly candidateCount: number;
  readonly fetchedCount: number;
  readonly writtenCount: number;
  readonly skipped: readonly ReleaseReconciliationSkip[];
};

export class ReleaseReconciliationService {
  constructor(private readonly options: ReleaseReconciliationServiceOptions) {}

  async reconcile(input: ReleaseReconciliationInput): Promise<ReleaseReconciliationResult> {
    const titleIds = input.historyRows.map((row) => row.titleId);
    const existingProjections = this.options.repository.getByTitleIds(titleIds);
    const plan = planReleaseReconciliationCandidates({
      trigger: input.trigger,
      now: input.now,
      historyRows: input.historyRows,
      existingProjections,
      mutedTitleIds: input.mutedTitleIds,
    });

    if (plan.candidates.length === 0 || input.signal?.aborted) {
      return {
        candidateCount: plan.candidates.length,
        fetchedCount: 0,
        writtenCount: 0,
        skipped: plan.skipped,
      };
    }

    try {
      const progress = await this.options.loadProgress(plan.candidates, input.signal);
      let writtenCount = 0;
      for (const result of progress) {
        this.options.repository.upsert(buildProjection(result, input.now));
        writtenCount += 1;
      }
      return {
        candidateCount: plan.candidates.length,
        fetchedCount: progress.length,
        writtenCount,
        skipped: plan.skipped,
      };
    } catch (error) {
      return this.handleLoadFailure(plan, existingProjections, input.now, error);
    }
  }

  private handleLoadFailure(
    plan: ReleaseReconciliationCandidatePlan,
    existingProjections: ReadonlyMap<string, ReleaseProgressProjection | ExistingReleaseProjection>,
    now: string,
    error: unknown,
  ): ReleaseReconciliationResult {
    let writtenCount = 0;
    for (const candidate of plan.candidates) {
      const existing = existingProjections.get(candidate.titleId);
      if (!isFullProjection(existing)) {
        this.options.repository.upsert({
          titleId: candidate.titleId,
          mediaKind: candidate.mediaKind,
          source: candidate.source,
          title: candidate.title,
          anchorSeason: candidate.anchorSeason,
          anchorEpisode: candidate.anchorEpisode,
          newEpisodeCount: 0,
          status: "unknown",
          checkedAt: now,
          nextCheckAt: new Date(Date.parse(now) + backoffMsForErrorCount(1)).toISOString(),
          staleAfterAt: new Date(Date.parse(now) + DEFAULT_STALE_TTL_MS).toISOString(),
          sourceFingerprint: `failure:${candidate.source}:${candidate.catalogId}`,
          errorCount: 1,
          lastError: errorMessage(error),
        });
        writtenCount += 1;
        continue;
      }
      const nextErrorCount = existing.errorCount + 1;
      this.options.repository.upsert({
        ...existing,
        checkedAt: now,
        nextCheckAt: new Date(
          Date.parse(now) + backoffMsForErrorCount(nextErrorCount),
        ).toISOString(),
        errorCount: nextErrorCount,
        lastError: errorMessage(error),
      });
      writtenCount += 1;
    }

    return {
      candidateCount: plan.candidates.length,
      fetchedCount: 0,
      writtenCount,
      skipped: plan.skipped,
    };
  }
}

function buildProjection(result: CatalogProgressResult, now: string): ReleaseProgressProjection {
  const latestAiredEpisode = result.latestAiredEpisode;
  const newEpisodeCount =
    typeof latestAiredEpisode === "number"
      ? Math.max(0, latestAiredEpisode - result.candidate.anchorEpisode)
      : 0;
  const status: ReleaseProgressProjection["status"] =
    newEpisodeCount > 0
      ? "new-episodes"
      : result.nextAiringAt
        ? "upcoming"
        : typeof latestAiredEpisode === "number"
          ? "caught-up"
          : "unknown";

  return {
    titleId: result.candidate.titleId,
    mediaKind: result.candidate.mediaKind,
    source: result.candidate.source,
    title: result.candidate.title,
    anchorSeason: result.candidate.anchorSeason,
    anchorEpisode: result.candidate.anchorEpisode,
    latestAiredSeason: result.latestAiredSeason,
    latestAiredEpisode: result.latestAiredEpisode,
    newEpisodeCount,
    nextAiringSeason: result.nextAiringSeason,
    nextAiringEpisode: result.nextAiringEpisode,
    nextAiringAt: result.nextAiringAt,
    latestKnownReleaseAt: result.latestKnownReleaseAt,
    status,
    checkedAt: now,
    nextCheckAt: nextCheckAt(result, now),
    staleAfterAt: new Date(Date.parse(now) + DEFAULT_STALE_TTL_MS).toISOString(),
    sourceFingerprint: result.sourceFingerprint,
    errorCount: 0,
  };
}

function nextCheckAt(result: CatalogProgressResult, now: string): string {
  if (result.nextAiringAt) {
    const nextAiringMs = Date.parse(result.nextAiringAt);
    if (Number.isFinite(nextAiringMs) && nextAiringMs > Date.parse(now)) {
      return new Date(nextAiringMs + 15 * 60 * 1000).toISOString();
    }
  }
  return new Date(Date.parse(now) + DEFAULT_REFRESH_INTERVAL_MS).toISOString();
}

function backoffMsForErrorCount(errorCount: number): number {
  const index = Math.min(Math.max(0, errorCount - 1), RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[index] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 15 * 60 * 1000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFullProjection(
  projection: ReleaseProgressProjection | ExistingReleaseProjection | undefined,
): projection is ReleaseProgressProjection {
  return Boolean(projection && "status" in projection && "errorCount" in projection);
}
