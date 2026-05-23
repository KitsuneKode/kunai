import type { Container } from "@/container";
import { toEpisodeCursor } from "@/domain/media/episode-cursor";
import { isFinished, type HistoryEntry } from "@/services/persistence/HistoryStore";

import type { ReleaseReconciliationHistoryRow, ReleaseReconciliationTrigger } from "./types";

type ReleaseReconciliationContainer = Pick<
  Container,
  "backgroundWorkScheduler" | "releaseReconciliationService" | "diagnosticsStore"
>;

export function enqueueReleaseReconciliation(
  container: ReleaseReconciliationContainer,
  entries: readonly (readonly [string, HistoryEntry])[],
  trigger: ReleaseReconciliationTrigger,
  signal?: AbortSignal,
): void {
  const historyRows = toReleaseReconciliationHistoryRows(entries);
  if (historyRows.length === 0 || signal?.aborted) return;

  container.backgroundWorkScheduler.enqueue({
    id: "release-reconciliation",
    lane: "attention-refresh",
    signal,
    run: async (workSignal) => {
      const result = await container.releaseReconciliationService.reconcile({
        trigger,
        now: new Date().toISOString(),
        historyRows,
        signal: workSignal,
      });
      container.diagnosticsStore.record({
        category: "cache",
        operation: "release-reconciliation.refresh",
        message: "Release reconciliation refreshed in background",
        context: {
          trigger,
          candidateCount: result.candidateCount,
          fetchedCount: result.fetchedCount,
          writtenCount: result.writtenCount,
          skippedCount: result.skipped.length,
          skippedReasons: result.skipped.map((skip) => skip.reason),
        },
      });
    },
  });
  void container.backgroundWorkScheduler.drain();
}

export function toReleaseReconciliationHistoryRows(
  entries: readonly (readonly [string, HistoryEntry])[],
): readonly ReleaseReconciliationHistoryRow[] {
  return entries.flatMap(([titleId, entry]) => {
    const cursor = toEpisodeCursor({ season: entry.season, episode: entry.episode });
    if (!cursor) return [];
    const mediaKind = entry.mediaKind ?? (entry.type === "movie" ? "movie" : "series");
    return [
      {
        titleId,
        mediaKind,
        title: entry.title,
        completed: isFinished(entry),
        externalIds: entry.externalIds,
        updatedAt: entry.watchedAt,
        ...cursor,
      },
    ];
  });
}
