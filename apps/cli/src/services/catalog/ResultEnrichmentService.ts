import {
  reconcileContinueHistory,
  type ContinueHistoryRelease,
  type ContinueHistoryReconciliationDecision,
} from "@/domain/continuation/history-reconciliation";
import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import type { SearchResult } from "@/domain/types";
import type {
  ContinuationSignals,
  ContinuationViewDecision,
  ContinueWatchingService,
} from "@/services/continuation/ContinueWatchingService";
import { historyContentType } from "@/services/continuation/history-progress";
import type { OfflineLibraryService } from "@/services/offline/OfflineLibraryService";
import type { HistoryStore } from "@/services/persistence/HistoryStore";
import { formatTimestamp, isFinished } from "@/services/persistence/HistoryStore";
import type { HistoryProgress } from "@kunai/storage";
import type { ProviderReleaseInfo } from "@kunai/types";

export type ResultEnrichmentBadgeTone = "success" | "info" | "warning" | "neutral";

export type ResultEnrichmentBadge = {
  readonly label: string;
  readonly tone: ResultEnrichmentBadgeTone;
};

export type ResultEnrichment = {
  readonly badges: readonly ResultEnrichmentBadge[];
};

export type ResultEnrichmentServiceDeps = {
  readonly historyStore: Pick<HistoryStore, "getAll">;
  readonly offlineLibraryService: Pick<OfflineLibraryService, "peekRecordedArtifactStatuses">;
  readonly continueWatchingService?: Pick<ContinueWatchingService, "titleDecision">;
  readonly getCachedNextRelease?: (result: SearchResult) => ContinueHistoryRelease | null;
  readonly now?: () => number;
  readonly ttlMs?: number;
};

type CacheEntry = {
  readonly expiresAt: number;
  readonly value: ResultEnrichment;
};

export class ResultEnrichmentService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly deps: ResultEnrichmentServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.ttlMs = deps.ttlMs ?? 30_000;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async enrichResults(
    results: readonly SearchResult[],
    options?: {
      /** Skip a redundant historyStore.getAll() when the caller already loaded history. */
      readonly preloadedHistory?: Record<string, HistoryProgress>;
    },
  ): Promise<ReadonlyMap<string, ResultEnrichment>> {
    const output = new Map<string, ResultEnrichment>();
    const missing = results.filter((result) => {
      const key = resultEnrichmentKey(result);
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > this.now()) {
        output.set(key, cached.value);
        return false;
      }
      return true;
    });

    if (missing.length === 0) return output;

    const [historyResult, offlineResult] = await Promise.allSettled([
      options?.preloadedHistory !== undefined
        ? Promise.resolve(options.preloadedHistory)
        : this.deps.historyStore.getAll(),
      this.deps.offlineLibraryService.peekRecordedArtifactStatuses(
        missing.map((result) => result.id),
        300,
      ),
    ]);
    const history = historyResult.status === "fulfilled" ? historyResult.value : {};
    const offlineEntries = offlineResult.status === "fulfilled" ? offlineResult.value : [];
    const offlineByTitleId = groupOfflineStatusesByTitleId(offlineEntries);

    for (const result of missing) {
      const historyEntry = history[result.id];
      const nextRelease =
        historyEntry && isFinished(historyEntry)
          ? (this.deps.getCachedNextRelease?.(result) ?? null)
          : null;
      const offlineStatuses = offlineByTitleId.get(result.id) ?? [];
      const decision =
        historyEntry && this.deps.continueWatchingService
          ? this.deps.continueWatchingService.titleDecision(result.id, {
              nextRelease: nextReleaseToContinuationSignal(nextRelease),
              offline: offlineStatusesToSignals(offlineStatuses),
            })
          : null;
      const enrichment = decision
        ? buildResultEnrichmentFromContinuation({
            result,
            decision,
            offlineStatuses,
          })
        : buildResultEnrichment({
            result,
            historyEntry,
            nextRelease,
            offlineStatuses,
          });
      const key = resultEnrichmentKey(result);
      this.cache.set(key, { expiresAt: this.now() + this.ttlMs, value: enrichment });
      output.set(key, enrichment);
    }

    return output;
  }
}

export function resultEnrichmentKey(result: Pick<SearchResult, "type" | "id">): string {
  return `${result.type}:${result.id}`;
}

function groupOfflineStatusesByTitleId(
  entries: ReadonlyArray<{ readonly titleId: string; readonly status: string }>,
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const entry of entries) {
    const bucket = grouped.get(entry.titleId);
    if (bucket) {
      bucket.push(entry.status);
    } else {
      grouped.set(entry.titleId, [entry.status]);
    }
  }
  return grouped;
}

function nextReleaseToContinuationSignal(
  release: ContinueHistoryRelease | null,
): ContinuationSignals["nextRelease"] {
  if (!release || release.season === undefined || release.episode === undefined) return null;
  return {
    season: release.season,
    episode: release.episode,
    released: release.status === "released",
    availableAt: release.releaseAt ?? undefined,
  };
}

function offlineStatusesToSignals(statuses: readonly string[]): ContinuationSignals["offline"] {
  const readyCount = statuses.filter((status) => status === "ready").length;
  if (readyCount === 0) return null;
  return { enrolled: true, readyNextEpisodes: [] };
}

export function buildResultEnrichment(input: {
  readonly result: SearchResult;
  readonly historyEntry?: Awaited<ReturnType<HistoryStore["get"]>> | null;
  readonly nextRelease?: ContinueHistoryRelease | null;
  readonly offlineStatuses?: readonly string[];
}): ResultEnrichment {
  const badges: ResultEnrichmentBadge[] = [];
  const providerReleaseBadge = badgeForProviderRelease(input.result.release);
  if (providerReleaseBadge) badges.push(providerReleaseBadge);
  if (input.historyEntry) {
    badges.push(
      ...badgesForHistoryDecision(
        resolveHistoryDecision({ ...input, historyEntry: input.historyEntry }),
      ),
    );
  }
  badges.push(...badgesForOfflineStatuses(input.result, input.offlineStatuses ?? []));
  return { badges };
}

export function buildResultEnrichmentFromContinuation(input: {
  readonly result: SearchResult;
  readonly decision: ContinuationViewDecision;
  readonly offlineStatuses?: readonly string[];
}): ResultEnrichment {
  const badges: ResultEnrichmentBadge[] = [];
  const providerReleaseBadge = badgeForProviderRelease(input.result.release);
  if (providerReleaseBadge) badges.push(providerReleaseBadge);
  badges.push(...badgesForContinuationDecision(input.decision));
  badges.push(...badgesForOfflineStatuses(input.result, input.offlineStatuses ?? []));
  return { badges };
}

function badgeForProviderRelease(
  release: ProviderReleaseInfo | undefined,
): ResultEnrichmentBadge | null {
  if (!release || release.status === "unknown") return null;
  if (release.status === "upcoming") return { label: "upcoming", tone: "info" };
  return { label: release.providerConfirmed ? "provider confirmed" : "released", tone: "success" };
}

function resolveHistoryDecision(input: {
  readonly result: SearchResult;
  readonly historyEntry: HistoryProgress;
  readonly nextRelease?: ContinueHistoryRelease | null;
}): ContinueHistoryReconciliationDecision {
  return reconcileContinueHistory({
    titleId: input.result.id,
    entries: [[input.result.id, input.historyEntry]],
    nextRelease: input.nextRelease,
  });
}

function badgesForHistoryDecision(
  decision: ContinueHistoryReconciliationDecision,
): ResultEnrichmentBadge[] {
  switch (decision.kind) {
    case "resume":
      return [{ label: formatContinueBadge(decision.entry), tone: "warning" }];
    case "new-episode":
      return [
        { label: formatEpisodeBadge("new", decision.season, decision.episode), tone: "info" },
      ];
    case "up-to-date": {
      const badges: ResultEnrichmentBadge[] = [{ label: "watched", tone: "success" }];
      if (decision.nextRelease?.status === "upcoming") {
        badges.push({
          label: formatEpisodeBadge(
            "next",
            decision.nextRelease.season,
            decision.nextRelease.episode,
          ),
          tone: "info",
        });
      }
      return badges;
    }
    case "empty":
      return [];
  }
}

function badgesForContinuationDecision(
  decision: ContinuationViewDecision,
): ResultEnrichmentBadge[] {
  switch (decision.state) {
    case "resume":
      return decision.target
        ? [{ label: formatContinueBadge(decision.target.sourceEntry), tone: "warning" }]
        : [];
    case "offline-ready":
      return [{ label: decision.badge ?? "downloaded", tone: "success" }];
    case "next-up":
      return [
        {
          label: formatEpisodeBadge("new", decision.target?.season, decision.target?.episode),
          tone: "info",
        },
      ];
    case "new-episodes":
      return [{ label: decision.badge ?? "new episodes", tone: "info" }];
    case "airing-weekly":
      return decision.target
        ? [
            {
              label: formatEpisodeBadge("next", decision.target.season, decision.target.episode),
              tone: "info",
            },
          ]
        : [];
    case "new-season":
      return [{ label: decision.badge ?? "new season", tone: "info" }];
    case "up-to-date":
      return [{ label: "watched", tone: "success" }];
    case "empty":
      return [];
  }
}

function badgesForOfflineStatuses(
  result: SearchResult,
  statuses: readonly string[],
): ResultEnrichmentBadge[] {
  const readyCount = statuses.filter((status) => status === "ready").length;
  if (readyCount > 0) {
    // Show how much is local so "3 downloaded, rest stream" is visible at a glance.
    const total = result.episodeCount;
    const label =
      result.type === "movie" || readyCount === 1
        ? "downloaded"
        : total && total > readyCount
          ? `↓ ${readyCount}/${total}`
          : `↓ ${readyCount}`;
    return [{ label, tone: "success" }];
  }
  if (
    statuses.some(
      (status) => status === "missing" || status === "invalid-file" || status === "repairable",
    )
  ) {
    return [{ label: "offline issue", tone: "warning" }];
  }
  return [];
}

function formatEpisodeBadge(prefix: string, season?: number, episode?: number): string {
  if (typeof episode !== "number") return prefix;
  const seasonLabel = typeof season === "number" ? `S${String(season).padStart(2, "0")}` : "";
  return `${prefix} ${seasonLabel}E${String(episode).padStart(2, "0")}`;
}

function formatContinueBadge(entry: HistoryProgress): string {
  const percentage = projectWatchProgress({
    timestamp: entry.positionSeconds,
    duration: entry.durationSeconds,
    completed: entry.completed,
  }).percentage;
  const progress = percentage !== null && percentage < 100 ? ` (${percentage}%)` : "";
  const timestamp =
    entry.positionSeconds > 10 ? ` · ${formatTimestamp(entry.positionSeconds)}` : "";
  const episode =
    historyContentType(entry) === "series"
      ? ` S${String(entry.season ?? 1).padStart(2, "0")}E${String(entry.episode ?? entry.absoluteEpisode ?? 1).padStart(2, "0")}`
      : "";
  return `continue${episode}${timestamp}${progress}`;
}
