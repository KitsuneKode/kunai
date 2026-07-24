import type {
  NotificationActionId,
  NotificationActionRouter,
  NotificationActionRunResult,
} from "@/services/notifications/NotificationActionRouter";
import type { NotificationRecord } from "@/services/storage/storage-read-models";

export type NotificationOverlayActionResult =
  | { readonly status: "confirmation-required"; readonly actionId: "play-now" }
  | Extract<NotificationActionRunResult, { readonly status: "unsupported" }>
  | (Extract<NotificationActionRunResult, { readonly status: "handled" }> & {
      readonly markReadError?: unknown;
    });

/**
 * Actions that do not consume the notice, so it stays unread and keeps its place
 * in Active. Queueing an episode is a *deferral*, not an acknowledgement — the
 * user still has not watched it, and sinking the notice under the read ordering
 * the moment they queue it reads as the item vanishing. `dismiss` is here for the
 * opposite reason: it is an explicit lifecycle operation that owns its own state.
 */
const NON_CONSUMING_ACTIONS: ReadonlySet<NotificationActionId> = new Set([
  "dismiss",
  "queue-next",
  "queue-after-current-chain",
  "queue-end",
  "add-to-up-next",
  "add-to-watchlist",
]);

const QUEUE_PLACEMENT_VERBS: Partial<Record<NotificationActionId, string>> = {
  "queue-next": "Playing next",
  "queue-after-current-chain": "Queued after the current series",
  "queue-end": "Queued at the end",
  "add-to-up-next": "Added to Up Next",
};

/**
 * Confirmation copy for the queueing actions, naming the title and how much is
 * now waiting. The generic "Action queued" it replaces named neither the episode
 * nor where it landed, so a working enqueue was indistinguishable from a no-op.
 * Returns null for non-queue actions so callers keep their own wording.
 */
export function describeQueuedNotificationAction(input: {
  readonly actionId: NotificationActionId;
  readonly title: string;
  readonly pendingCount: number;
}): string | null {
  const verb = QUEUE_PLACEMENT_VERBS[input.actionId];
  if (!verb) return null;
  const pending =
    input.pendingCount > 0 ? ` · ${String(input.pendingCount)} waiting in Up Next` : "";
  return `${verb}: ${input.title}${pending}`;
}

export type ExecuteNotificationOverlayActionInput = {
  readonly router: Pick<NotificationActionRouter, "run">;
  readonly notification: NotificationRecord;
  readonly actionId: NotificationActionId;
  readonly playbackActive: boolean;
  readonly confirmedContextSwitch?: boolean;
  readonly markRead: (dedupKey: string) => Promise<void> | void;
};

/**
 * Confirmation gating and success-sensitive read lifecycle for the Notifications
 * overlay: only a confirmed, handled, non-lifecycle action marks the notice read.
 * Unsupported outcomes, thrown executor errors, and stored `dismiss` leave read
 * state untouched — dismiss/archive/delete remain explicit lifecycle operations.
 */
export async function executeNotificationOverlayAction(
  input: ExecuteNotificationOverlayActionInput,
): Promise<NotificationOverlayActionResult> {
  if (
    input.actionId === "play-now" &&
    input.playbackActive &&
    input.confirmedContextSwitch !== true
  ) {
    return { status: "confirmation-required", actionId: "play-now" };
  }

  const result = await input.router.run({
    notification: input.notification,
    actionId: input.actionId,
    playbackActive: input.playbackActive,
    confirmedContextSwitch: input.confirmedContextSwitch,
  });

  if (result.status === "handled" && !NON_CONSUMING_ACTIONS.has(input.actionId)) {
    try {
      await input.markRead(input.notification.dedupKey);
    } catch (markReadError) {
      return { ...result, markReadError };
    }
  }

  return result;
}
