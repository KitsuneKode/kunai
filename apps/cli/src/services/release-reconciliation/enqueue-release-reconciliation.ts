import type { Container } from "@/container";
import { toEpisodeCursor } from "@/domain/media/episode-cursor";
import { isFinished } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@kunai/storage";

import type {
  ReleaseReconciliationAttention,
  ReleaseReconciliationHistoryRow,
  ReleaseReconciliationTrigger,
} from "./types";

type ReleaseReconciliationContainer = Pick<
  Container,
  | "backgroundWorkScheduler"
  | "releaseReconciliationService"
  | "diagnosticsService"
  | "offlineTitlePolicies"
  | "config"
>;

const POWER_SAVER_PASSIVE_TRIGGERS: ReadonlySet<ReleaseReconciliationTrigger> = new Set([
  "startup",
  "browse-idle",
  "history",
  "calendar",
  "post-playback",
]);

export function enqueueReleaseReconciliation(
  container: ReleaseReconciliationContainer,
  rows: readonly HistoryProgress[],
  trigger: ReleaseReconciliationTrigger,
  signal?: AbortSignal,
): void {
  if (container.config.powerSaverMode && POWER_SAVER_PASSIVE_TRIGGERS.has(trigger)) {
    return;
  }
  const historyRows = toReleaseReconciliationHistoryRows(rows);
  if (historyRows.length === 0 || signal?.aborted) return;
  const enrolledTitleIds = new Set(
    container.offlineTitlePolicies
      .listByTitleIds(historyRows.map((row) => row.titleId))
      .filter((policy) => policy.enrolled)
      .map((policy) => policy.titleId),
  );
  const attentionByTitleId = new Map(
    historyRows.map((row) => {
      const attention: ReleaseReconciliationAttention = enrolledTitleIds.has(row.titleId)
        ? "offline-enrolled"
        : trigger === "history"
          ? "continue-visible"
          : "dormant-history";
      return [row.titleId, attention];
    }),
  );

  container.backgroundWorkScheduler.enqueue({
    id: "release-reconciliation",
    lane: "attention-refresh",
    signal,
    run: async (workSignal) => {
      const result = await container.releaseReconciliationService.reconcile({
        trigger,
        now: new Date().toISOString(),
        historyRows,
        attentionByTitleId,
        signal: workSignal,
      });
      container.diagnosticsService.record({
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
  rows: readonly HistoryProgress[],
): readonly ReleaseReconciliationHistoryRow[] {
  return rows.flatMap((row) => {
    const cursor = toEpisodeCursor({
      season: row.season ?? 1,
      episode: row.episode ?? row.absoluteEpisode ?? 1,
    });
    if (!cursor) return [];
    return [
      {
        titleId: row.titleId,
        mediaKind: row.mediaKind,
        title: row.title,
        completed: isFinished(row),
        externalIds: row.externalIds,
        updatedAt: row.updatedAt,
        ...cursor,
      },
    ];
  });
}
