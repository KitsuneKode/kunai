import type { Container } from "@/container";
import { isFreshlyAiredSinceWatch } from "@/domain/continuation/history-bucket";
import { toEpisodeCursor } from "@/domain/media/episode-cursor";
import { readLatestHistoryByTitle, isFinished } from "@/services/continuation/history-progress";
import type { FollowedTitleRecord, HistoryProgress } from "@kunai/storage";

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
  | "releaseProgressCache"
  | "notificationService"
  | "historyRepository"
  | "followedTitleRepository"
>;

const POWER_SAVER_PASSIVE_TRIGGERS: ReadonlySet<ReleaseReconciliationTrigger> = new Set([
  "startup",
  "browse-idle",
  "history",
  "calendar",
  "post-playback",
]);

function syntheticHistoryFromFollowed(record: FollowedTitleRecord): HistoryProgress {
  const now = record.updatedAt;
  return {
    key: `followed:${record.titleId}`,
    titleId: record.titleId,
    mediaKind: record.mediaKind as HistoryProgress["mediaKind"],
    title: record.title,
    season: 1,
    episode: 0,
    positionSeconds: 0,
    completed: false,
    updatedAt: now,
    createdAt: now,
  };
}

/** History anchors plus followed titles that have no watch history yet. */
export function collectReleaseReconciliationRows(
  container: Pick<Container, "historyRepository" | "followedTitleRepository">,
): readonly HistoryProgress[] {
  const history = Object.values(readLatestHistoryByTitle(container.historyRepository));
  const historyIds = new Set(history.map((row) => row.titleId));
  const followedOnly = container.followedTitleRepository
    .listByPreference("following")
    .filter((record) => !historyIds.has(record.titleId))
    .map(syntheticHistoryFromFollowed);
  return [...history, ...followedOnly];
}

function catalogSourceLabel(source: string): boolean {
  return source === "anilist" || source === "tmdb";
}

function shouldNotifyForProjection(
  projection: { readonly newEpisodeCount: number; readonly latestKnownReleaseAt?: string | null },
  historyRow: HistoryProgress | undefined,
): boolean {
  if (projection.newEpisodeCount <= 0) return false;
  if (!historyRow) return true;
  if (!isFinished(historyRow)) return false;
  return isFreshlyAiredSinceWatch(projection.latestKnownReleaseAt, historyRow.updatedAt);
}

export function enqueueReleaseReconciliation(
  container: ReleaseReconciliationContainer,
  rows: readonly HistoryProgress[],
  trigger: ReleaseReconciliationTrigger,
  signal?: AbortSignal,
  options: { readonly onComplete?: () => void | Promise<void> } = {},
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

      // Surface reconciliation-found new episodes as notifications for every
      // reconciled (continue-watching + followed) title — these are exactly the
      // "unwatched releases" shown on the home screen. recordSignals drops muted
      // titles via the engine, so muting a title still silences it. The shared
      // release-progress projection is the source of truth; the writer race is
      // resolved upstream (ReleaseProgressWriter).
      const reconciledTitleIds = historyRows.map((row) => row.titleId);
      if (reconciledTitleIds.length > 0) {
        const historyByTitle = new Map(rows.map((row) => [row.titleId, row] as const));
        const projections = container.releaseProgressCache.getByTitleIds(reconciledTitleIds);
        const newEpisodeSignals = [...projections.values()]
          .filter((projection) =>
            shouldNotifyForProjection(projection, historyByTitle.get(projection.titleId)),
          )
          .map((projection) => {
            const historyRow = historyByTitle.get(projection.titleId);
            const providerId = historyRow?.providerId ?? projection.source;
            return {
              type: "new-playable-episode" as const,
              titleId: projection.titleId,
              mediaKind: projection.mediaKind,
              title: projection.title,
              season: projection.latestAiredSeason,
              episode: projection.latestAiredEpisode,
              providerId,
              catalogSource: catalogSourceLabel(projection.source) ? projection.source : undefined,
              availableAt: projection.checkedAt,
            };
          });
        if (newEpisodeSignals.length > 0) {
          container.notificationService.recordSignals(newEpisodeSignals);
        }
      }
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
      await options.onComplete?.();
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
