import type { ShellPickerOption, ShellStatusTone } from "@/app-shell/types";
import {
  parseNotificationActionIds,
  type NotificationActionId,
} from "@/services/notifications/NotificationActionRouter";
import type { NotificationRecord } from "@kunai/storage";

export function buildNotificationPickerOptions(
  notifications: readonly NotificationRecord[],
): readonly ShellPickerOption<string>[] {
  return notifications.map((notification) => {
    const primaryAction = getNotificationPrimaryAction(notification);
    return {
      value: notification.dedupKey,
      label: notification.title,
      detail: notification.body,
      tone: getNotificationTone(notification.kind),
      badge: `enter: ${getNotificationActionBadge(primaryAction)}  ·  a: all actions  ·  x: dismiss`,
    };
  });
}

export function getNotificationPrimaryAction(
  notification: NotificationRecord,
): NotificationActionId {
  return (
    parseNotificationActionIds(notification).find((action) => action !== "dismiss") ?? "dismiss"
  );
}

export function buildNotificationActionOptions(
  notification: NotificationRecord,
): readonly ShellPickerOption<NotificationActionId>[] {
  const actions = parseNotificationActionIds(notification);
  const normalized = actions.length > 0 ? actions : (["dismiss"] as const);
  return normalized.map((action) => ({
    value: action,
    label: getNotificationActionLabel(action),
    detail: getNotificationActionDetail(action),
    tone: action === "restore-queue" ? "warning" : action === "download" ? "success" : "neutral",
  }));
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
  if (action === "add-to-playlist") return "Add to playlist";
  if (action === "follow") return "Follow";
  if (action === "mute") return "Mute";
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
  if (action === "add-to-playlist") return "Save this item to a durable playlist";
  if (action === "follow") return "Track future releases for this title";
  if (action === "mute") return "Stop future release notices for this title";
  return "Run this action";
}
