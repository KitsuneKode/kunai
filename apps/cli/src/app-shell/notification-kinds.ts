export const NOTIFICATION_KIND_GLYPH: Record<string, string> = {
  "new-episode": "●",
  "download-complete": "⬇",
  "download-failed": "⚠",
  "queue-recovery": "↩",
  "app-update": "⬆",
};

export const NOTIFICATION_KIND_LABEL: Record<string, string> = {
  "new-episode": "New episode",
  "download-complete": "Download complete",
  "download-failed": "Download failed",
  "queue-recovery": "Queue recovered",
  "app-update": "Update available",
};

export function notificationKindGlyph(kind: string): string {
  return NOTIFICATION_KIND_GLYPH[kind] ?? "●";
}

export function notificationKindLabel(kind: string): string {
  return NOTIFICATION_KIND_LABEL[kind] ?? "Notification";
}
