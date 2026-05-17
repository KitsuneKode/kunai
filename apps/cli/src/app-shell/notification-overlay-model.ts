import type { ShellPickerOption, ShellStatusTone } from "@/app-shell/types";
import {
  parseNotificationActionIds,
  type NotificationActionId,
} from "@/services/notifications/NotificationActionRouter";
import type { NotificationRecord } from "@kunai/storage";

export function buildNotificationPickerOptions(
  notifications: readonly NotificationRecord[],
): readonly ShellPickerOption<string>[] {
  return notifications.map((notification) => ({
    value: notification.dedupKey,
    label: notification.title,
    detail: notification.body,
    tone: getNotificationTone(notification.kind),
    badge: getNotificationActionBadge(getNotificationPrimaryAction(notification)),
  }));
}

export function getNotificationPrimaryAction(
  notification: NotificationRecord,
): NotificationActionId {
  return (
    parseNotificationActionIds(notification).find((action) => action !== "dismiss") ?? "dismiss"
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
