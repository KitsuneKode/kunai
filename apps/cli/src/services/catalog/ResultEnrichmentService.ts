import type { SearchResult } from "@/domain/types";
import type { OfflineLibraryService } from "@/services/offline/OfflineLibraryService";
import type { HistoryStore } from "@/services/persistence/HistoryStore";
import { isFinished } from "@/services/persistence/HistoryStore";

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
  readonly offlineLibraryService: Pick<OfflineLibraryService, "validateCompletedArtifacts">;
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
      this.deps.offlineLibraryService.validateCompletedArtifacts(300),
    ]);
    const history = historyResult.status === "fulfilled" ? historyResult.value : {};
    const offlineEntries = offlineResult.status === "fulfilled" ? offlineResult.value : [];

    for (const result of missing) {
      const enrichment = buildResultEnrichment({
        result,
        historyEntry: history[result.id],
        offlineStatuses: offlineEntries
          .filter((entry) => entry.job.titleId === result.id)
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
  readonly offlineStatuses?: readonly string[];
}): ResultEnrichment {
  const badges: ResultEnrichmentBadge[] = [];
  if (input.historyEntry) {
    badges.push(
      isFinished(input.historyEntry)
        ? { label: "watched", tone: "success" }
        : { label: "in progress", tone: "warning" },
    );
  }
  if (input.offlineStatuses?.includes("ready")) {
    badges.push({ label: "downloaded", tone: "success" });
  } else if (
    input.offlineStatuses?.some((status) => status === "missing" || status === "invalid-file")
  ) {
    badges.push({ label: "offline issue", tone: "warning" });
  }
  return { badges };
}
