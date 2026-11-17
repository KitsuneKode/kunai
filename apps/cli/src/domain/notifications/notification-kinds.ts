export const NOTIFICATION_KINDS = [
  "new-episode",
  "queue-recovery",
  "download-complete",
  "download-failed",
  "app-update",
  "app-restart-required",
  "provider-health",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

const NOTIFICATION_KIND_SET: ReadonlySet<string> = new Set(NOTIFICATION_KINDS);

/** Narrow a persisted or dynamic string to a known {@link NotificationKind}. */
export function isNotificationKind(kind: string): kind is NotificationKind {
  return NOTIFICATION_KIND_SET.has(kind);
}
