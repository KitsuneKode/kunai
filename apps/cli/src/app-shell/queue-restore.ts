// =============================================================================
// queue-restore.ts — container adapter + status copy for queue session restore.
//
// Both restore entry points (the queue overlay's `r` key and the
// queue-recovery notification action) route through here so they cannot drift
// apart — the notification path used to be the only one that named its target
// session explicitly.
//
// Domain restore prefers queue-owned in-flight identity, then promotes an exact
// history match among restored rows. It never invents a new queue entry.
// =============================================================================

import type { Container } from "@/container";
import { formatQueueEntryLabel } from "@/domain/queue/queue-entry-label";
import type {
  QueueRestoreResult,
  RestoreQueueSessionDeps,
} from "@/domain/queue/restore-queue-session";

export function buildQueueRestoreDeps(container: Container): RestoreQueueSessionDeps {
  return {
    queue: container.queueService,
    readHistory: () => container.historyRepository.listLatestByTitle(),
  };
}

/**
 * Status line for a completed restore. Names the resume head when there is one,
 * so pressing `r` reports what actually came back instead of restoring silently.
 */
export function buildQueueRestoreStatus(
  result: QueueRestoreResult,
  recoverableSessionCount: number,
): string {
  if (result.restoredCount <= 0) return "Queue session is no longer recoverable";

  const items = `${result.restoredCount} item${result.restoredCount === 1 ? "" : "s"}`;
  const resumeLabel = formatQueueEntryLabel(result.resumeHead);
  const restored = resumeLabel
    ? `Restored ${items} · resuming ${resumeLabel}`
    : `Restored ${items}`;

  // Only mention the remainder when another recoverable session is still waiting.
  return recoverableSessionCount > 1
    ? `${restored} · ${recoverableSessionCount - 1} older queue kept`
    : restored;
}
