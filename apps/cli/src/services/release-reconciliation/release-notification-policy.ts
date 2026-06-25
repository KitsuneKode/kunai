import { isFreshlyAiredSinceWatch } from "@/domain/continuation/history-bucket";
import { isFinished } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@kunai/storage";
import type { ReleaseProgressProjection } from "@kunai/storage";

/** Shared "+N new" count for calendar badges, history rails, and notifications. */
export function activeNewEpisodeCount(
  projection:
    | Pick<ReleaseProgressProjection, "status" | "newEpisodeCount" | "staleAfterAt">
    | undefined,
  nowMs: number = Date.now(),
): number {
  if (!projection || projection.status !== "new-episodes") return 0;
  const staleAfterMs = Date.parse(projection.staleAfterAt);
  if (Number.isFinite(staleAfterMs) && staleAfterMs <= nowMs) return 0;
  return Math.max(0, Math.trunc(projection.newEpisodeCount));
}

/**
 * Whether a reconciled projection should surface as a user notification.
 * Matches history bucket freshness: finished titles only notify when the
 * release aired after the user's last watch.
 */
export function shouldNotifyForReleaseProjection(
  projection: Pick<
    ReleaseProgressProjection,
    "newEpisodeCount" | "latestKnownReleaseAt" | "status" | "staleAfterAt"
  >,
  historyRow: HistoryProgress | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (activeNewEpisodeCount(projection, nowMs) <= 0) return false;
  if (!historyRow) return true;
  if (!isFinished(historyRow)) return false;
  return isFreshlyAiredSinceWatch(projection.latestKnownReleaseAt, historyRow.updatedAt);
}
