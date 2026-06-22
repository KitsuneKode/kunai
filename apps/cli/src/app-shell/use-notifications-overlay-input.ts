import type { LineEditorKey } from "@/app-shell/line-editor";
import type { Container } from "@/container";
import type { NotificationActionId } from "@/services/notifications/NotificationActionRouter";

export type NotificationsOverlayInputContext = {
  readonly container: Container;
  readonly notifRow: { readonly dedupKey: string } | undefined;
  readonly totalPages: number;
  readonly onRedraw: () => void;
  readonly setNotifTab: (update: (prev: "active" | "archive") => "active" | "archive") => void;
  readonly setNotifPage: (update: (prev: number) => number) => void;
  readonly setSelectedIndex: (update: (current: number) => number) => void;
  readonly setNotifTick: (update: (tick: number) => number) => void;
  readonly setOverlayStatus: (status: string) => void;
  readonly setNotificationActionDedupKey: (key: string) => void;
  readonly setFilterQuery: (query: string) => void;
};

export type NotificationsOverlayInputResult = "handled" | "not-handled";

/**
 * Notification overlay key map extracted from root-overlay-shell for incremental
 * input-routing consolidation (Phase 9).
 */
export function handleNotificationsOverlayInput(
  input: string,
  key: LineEditorKey,
  ctx: NotificationsOverlayInputContext,
): NotificationsOverlayInputResult {
  const { notifRow } = ctx;

  if (key.tab) {
    ctx.setNotifTab((prev) => (prev === "active" ? "archive" : "active"));
    ctx.setNotifPage(() => 0);
    ctx.setSelectedIndex(() => 0);
    return "handled";
  }
  if (input === "[") {
    ctx.setNotifPage((page) => Math.max(0, page - 1));
    ctx.setSelectedIndex(() => 0);
    return "handled";
  }
  if (input === "]") {
    ctx.setNotifPage((page) => Math.min(ctx.totalPages - 1, page + 1));
    ctx.setSelectedIndex(() => 0);
    return "handled";
  }
  if (input === "A") {
    ctx.container.notificationService.markAllRead();
    ctx.setNotifTick((tick) => tick + 1);
    return "handled";
  }
  if (input === "r" && notifRow) {
    ctx.container.notificationService.markRead(notifRow.dedupKey);
    ctx.setNotifTick((tick) => tick + 1);
    return "handled";
  }
  if (input.toLowerCase() === "x" && notifRow) {
    ctx.container.notificationService.archive(notifRow.dedupKey);
    ctx.setNotifTick((tick) => tick + 1);
    ctx.setSelectedIndex((current) => Math.max(0, current - 1));
    return "handled";
  }
  if (input === "d" && notifRow) {
    ctx.container.notificationService.delete(notifRow.dedupKey);
    ctx.setNotifTick((tick) => tick + 1);
    ctx.setSelectedIndex((current) => Math.max(0, current - 1));
    ctx.setOverlayStatus("Notification deleted");
    return "handled";
  }
  if (input === "C") {
    const removed = ctx.container.notificationService.clearArchived();
    ctx.setNotifTick((tick) => tick + 1);
    ctx.setNotifPage(() => 0);
    ctx.setSelectedIndex(() => 0);
    ctx.setOverlayStatus(removed > 0 ? `Cleared ${removed} archived` : "Nothing to clear");
    return "handled";
  }
  if (input.toLowerCase() === "a" && notifRow) {
    ctx.setNotificationActionDedupKey(notifRow.dedupKey);
    ctx.setFilterQuery("");
    ctx.setSelectedIndex(() => 0);
    return "handled";
  }

  return "not-handled";
}

/** Type-only export for action routing call sites. */
export type { NotificationActionId };
