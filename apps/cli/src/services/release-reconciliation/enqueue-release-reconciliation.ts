import type { Container } from "@/container";
import { toEpisodeCursor } from "@/domain/media/episode-cursor";
import { buildAttentionRefreshCandidates } from "@/services/attention/build-attention-refresh-candidates";
import { readLatestHistoryByTitle, isFinished } from "@/services/continuation/history-progress";
import type { FollowedTitleRecord, HistoryProgress } from "@kunai/storage";

import { shouldNotifyForReleaseProjection } from "./release-notification-policy";
import type {
  ReleaseReconciliationAttention,
  ReleaseReconciliationHistoryRow,
  ReleaseReconciliationTrigger,
} from "./types";

type ReleaseReconciliationContainer = Pick<
  Container,
  | "attentionRefreshWorker"
  | "backgroundWorkScheduler"
  | "releaseReconciliationService"
  | "diagnosticsService"
  | "featureFlags"
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
            shouldNotifyForReleaseProjection(projection, historyByTitle.get(projection.titleId)),
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

      if (container.featureFlags.providerAvailabilitySync) {
        const refreshCandidates = buildAttentionRefreshCandidates({
          rows,
          followedTitleRepository: container.followedTitleRepository,
        });
        const refreshBudget = trigger === "calendar" || trigger === "history" ? 5 : 3;
        await container.attentionRefreshWorker.runOnce({
          candidates: refreshCandidates,
          maxChecks: refreshBudget,
          now: new Date().toISOString(),
          minIntervalMs: 30 * 60 * 1000,
          signal: workSignal,
        });
      }

      await options.onComplete?.();
    },
  });
  void container.backgroundWorkScheduler.drain();
}

export function toReleaseReconciliationHistoryRows(
  rows: readonly HistoryProgress[],
): readonly ReleaseReconciliationHistoryRow[] {
  return rows.flatMap((row) => {
    // A followed-but-unwatched title anchors at episode 0 (see
    // syntheticHistoryFromFollowed). `0 ?? 1` is 0 — nullish coalescing only
    // falls through on null/undefined — and the cursor guard rejects episode <= 0,
    // so those rows used to be dropped here and the title could never be checked
    // for new episodes. Treat "no progress yet" as "before episode 1" instead.
    const episode = row.episode ?? row.absoluteEpisode ?? 1;
    const cursor = toEpisodeCursor({
      season: row.season ?? 1,
      episode: episode > 0 ? episode : 1,
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
