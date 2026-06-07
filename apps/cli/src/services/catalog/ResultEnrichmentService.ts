import {
  reconcileContinueHistory,
  type ContinueHistoryRelease,
  type ContinueHistoryReconciliationDecision,
} from "@/domain/continuation/history-reconciliation";
import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import type { SearchResult } from "@/domain/types";
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
      this.deps.historyStore.getAll(),
      this.deps.offlineLibraryService.peekRecordedArtifactStatuses(
        missing.map((result) => result.id),
        300,
      ),
    ]);
    const history = historyResult.status === "fulfilled" ? historyResult.value : {};
    const offlineEntries = offlineResult.status === "fulfilled" ? offlineResult.value : [];

    for (const result of missing) {
      const historyEntry = history[result.id];
      const nextRelease =
        historyEntry && isFinished(historyEntry)
          ? (this.deps.getCachedNextRelease?.(result) ?? null)
          : null;
      const enrichment = buildResultEnrichment({
        result,
        historyEntry,
        nextRelease,
        offlineStatuses: offlineEntries
          .filter((entry) => entry.titleId === result.id)
          .map((entry) => entry.status),
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
  const readyCount = input.offlineStatuses?.filter((status) => status === "ready").length ?? 0;
  if (readyCount > 0) {
    // Show how much is local so "3 downloaded, rest stream" is visible at a glance.
    const total = input.result.episodeCount;
    const label =
      input.result.type === "movie" || readyCount === 1
        ? "downloaded"
        : total && total > readyCount
          ? `↓ ${readyCount}/${total}`
          : `↓ ${readyCount}`;
    badges.push({ label, tone: "success" });
  } else if (
    input.offlineStatuses?.some(
      (status) => status === "missing" || status === "invalid-file" || status === "repairable",
    )
  ) {
    badges.push({ label: "offline issue", tone: "warning" });
  }
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
