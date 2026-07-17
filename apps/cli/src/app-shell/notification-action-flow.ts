import type {
  NotificationActionId,
  NotificationActionRouter,
  NotificationActionRunResult,
} from "@/services/notifications/NotificationActionRouter";
import type { NotificationRecord } from "@kunai/storage";

export type NotificationOverlayActionResult =
  | { readonly status: "confirmation-required"; readonly actionId: "play-now" }
  | NotificationActionRunResult;

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

  if (result.status === "handled" && input.actionId !== "dismiss") {
    await input.markRead(input.notification.dedupKey);
  }

  return result;
}
