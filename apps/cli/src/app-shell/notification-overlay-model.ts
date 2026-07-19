import type { ShellPickerOption, ShellStatusTone } from "@/app-shell/types";
import {
  parseNotificationActionIds,
  type NotificationActionId,
} from "@/services/notifications/NotificationActionRouter";
import type { NotificationRecord } from "@/services/storage/storage-read-models";

const OVERLAY_NOTIFICATION_ACTIONS = new Set<NotificationActionId>([
  "restore-queue",
  "retry-download",
  "update-app",
  "queue-next",
  "queue-after-current-chain",
  "queue-end",
  "download",
  "follow",
  "unfollow",
  "unmute",
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
    getExecutableNotificationActions(notification).find((action) => action !== "dismiss") ??
    "dismiss"
  );
}

export type NotificationActionPresentation = {
  readonly id: NotificationActionId;
  readonly label: string;
  readonly detail: string;
  readonly tone: ShellStatusTone;
};

export function getExecutableNotificationActions(
  notification: NotificationRecord,
): readonly NotificationActionId[] {
  return parseNotificationActionIds(notification).filter((action) =>
    OVERLAY_NOTIFICATION_ACTIONS.has(action),
  );
}

export function getNotificationActionPresentation(
  action: NotificationActionId,
): NotificationActionPresentation {
  return {
    id: action,
    label: getNotificationActionLabel(action),
    detail: getNotificationActionDetail(action),
    tone:
      action === "restore-queue" || action === "retry-download"
        ? "warning"
        : action === "download"
          ? "success"
          : "neutral",
  };
}

export function buildNotificationActionOptions(
  notification: NotificationRecord,
): readonly ShellPickerOption<NotificationActionId>[] {
  const actions = getExecutableNotificationActions(notification);
  const normalized = actions.length > 0 ? actions : (["dismiss"] as const);
  return normalized.map((action) => {
    const presentation = getNotificationActionPresentation(action);
    return {
      value: presentation.id,
      label: presentation.label,
      detail: presentation.detail,
      tone: presentation.tone,
    };
  });
}

export function getSelectedNotificationActionId(
  options: readonly ShellPickerOption<NotificationActionId>[],
  selectedIndex: number,
): NotificationActionId | null {
  return options[selectedIndex]?.value ?? null;
}

export function selectNotificationPickerOptions<TInbox, TAction, TConfirmation>(input: {
  readonly confirmationActive: boolean;
  readonly actionPickerActive: boolean;
  readonly inbox: readonly TInbox[];
  readonly actions: readonly TAction[];
  readonly confirmation: readonly TConfirmation[];
}): readonly TInbox[] | readonly TAction[] | readonly TConfirmation[] {
  if (input.confirmationActive) return input.confirmation;
  if (input.actionPickerActive) return input.actions;
  return input.inbox;
}

export function getNotificationTone(kind: string): ShellStatusTone {
  if (kind === "queue-recovery") return "warning";
  if (kind === "download-failed") return "error";
  if (kind === "new-episode" || kind === "download-complete") return "success";
  if (kind === "app-update") return "info";
  return "neutral";
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
  if (action === "retry-download") return "Retry download";
  if (action === "update-app") return "Open release page";
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
  if (action === "unmute") return "Unmute release notices";
  if (action === "mute") return "Mute release notices";
  return "Run action";
}

function getNotificationActionDetail(action: NotificationActionId): string {
  if (action === "restore-queue")
    return "Restore pending items into the current queue without autoplay";
  if (action === "retry-download") return "Retry this item through the standard download action";
  if (action === "update-app") return "Open the release page for the advertised Kunai version";
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
  if (action === "unmute") return "Restore neutral release attention for this title";
  if (action === "mute") return "Stop future release notices for this title";
  return "Run this action";
}
