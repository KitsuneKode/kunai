import type { ShellPickerOption, ShellStatusTone } from "@/app-shell/types";
import {
  parseNotificationActionIds,
  type NotificationActionId,
} from "@/services/notifications/NotificationActionRouter";
import type { NotificationRecord } from "@/services/storage/storage-read-models";

const OVERLAY_NOTIFICATION_ACTIONS = new Set<NotificationActionId>([
  "restore-queue",
  "queue-next",
  "queue-after-current-chain",
  "queue-end",
  "download",
  "follow",
  "unfollow",
  "mute",
  "add-to-watchlist",
  "add-to-up-next",
  "play-now",
  "open-details",
  "dismiss",
]);

export function buildNotificationPickerOptions(
  notifications: readonly NotificationRecord[],
  options: { subActionsActive?: boolean } = {},
): readonly ShellPickerOption<string>[] {
  const subActionsActive = options.subActionsActive === true;
  return notifications.map((notification) => {
    const primaryAction = getNotificationPrimaryAction(notification);
    // The "x: dismiss" hint is a lie when the sub-action picker is open —
    // `x` is gated by `notificationActionDedupKey` and only dismisses from
    // the top-level picker. Drop the `x` segment in sub-actions mode so the
    // badge never advertises a no-op.
    const badge = subActionsActive
      ? `enter: ${getNotificationActionBadge(primaryAction)}  ·  a: all actions  ·  esc: back`
      : `enter: ${getNotificationActionBadge(primaryAction)}  ·  a: all actions  ·  x: dismiss`;
    return {
      value: notification.dedupKey,
      label: notification.title,
      detail: notification.body,
      tone: getNotificationTone(notification.kind),
      badge,
    };
  });
}

export function getNotificationPrimaryAction(
  notification: NotificationRecord,
): NotificationActionId {
  return (
    parseExecutableNotificationActions(notification).find((action) => action !== "dismiss") ??
    "dismiss"
  );
}

export function buildNotificationActionOptions(
  notification: NotificationRecord,
): readonly ShellPickerOption<NotificationActionId>[] {
  const actions = parseExecutableNotificationActions(notification);
  const normalized = actions.length > 0 ? actions : (["dismiss"] as const);
  return normalized.map((action) => ({
    value: action,
    label: getNotificationActionLabel(action),
    detail: getNotificationActionDetail(action),
    tone: action === "restore-queue" ? "warning" : action === "download" ? "success" : "neutral",
  }));
}

function parseExecutableNotificationActions(
  notification: NotificationRecord,
): readonly NotificationActionId[] {
  return parseNotificationActionIds(notification).filter((action) =>
    OVERLAY_NOTIFICATION_ACTIONS.has(action),
  );
}

function getNotificationTone(kind: string): ShellStatusTone {
  if (kind === "queue-recovery") return "warning";
  if (kind === "new-episode") return "success";
  return "info";
}

function getNotificationActionBadge(action: NotificationActionId): string {
  if (action === "restore-queue") return "restore";
  if (action === "queue-next") return "queue next";
  if (action === "queue-end") return "queue";
  if (action === "download") return "download";
  if (action === "dismiss") return "dismiss";
  return action.replaceAll("-", " ");
}

function getNotificationActionLabel(action: NotificationActionId): string {
  if (action === "restore-queue") return "Restore queue";
  if (action === "queue-next") return "Queue next";
  if (action === "queue-after-current-chain") return "Queue after current series";
  if (action === "queue-end") return "Queue at end";
  if (action === "download") return "Download";
  if (action === "dismiss") return "Dismiss";
  if (action === "play-now") return "Play now";
  if (action === "open-details") return "Open details";
  if (action === "add-to-watchlist") return "Add to Watchlist";
  if (action === "add-to-up-next") return "Add to Up Next";
  if (action === "follow") return "Follow releases";
  if (action === "unfollow") return "Unfollow releases";
  if (action === "mute") return "Mute release notices";
  return "Run action";
}

function getNotificationActionDetail(action: NotificationActionId): string {
  if (action === "restore-queue")
    return "Restore pending items into the current queue without autoplay";
  if (action === "queue-next") return "Place this item next without replacing playback";
  if (action === "queue-after-current-chain")
    return "Place this item after the current series chain";
  if (action === "queue-end") return "Add this item to the end of the queue";
  if (action === "download") return "Queue this item for offline download when available";
  if (action === "dismiss") return "Hide this notice";
  if (action === "play-now") return "Start playback after explicit confirmation when needed";
  if (action === "open-details") return "Open local details for this notice";
  if (action === "add-to-watchlist") return "Save this item to your Watchlist";
  if (action === "add-to-up-next") return "Add this item to the end of Up Next";
  if (action === "follow") return "Track future releases for this title";
  if (action === "unfollow") return "Stop explicit release tracking without muting";
  if (action === "mute") return "Stop future release notices for this title";
  return "Run this action";
}
