/**
 * One glyph per kind, and none of them a filled dot.
 *
 * The row prefixes an unread dot before this glyph, so `new-episode` rendering
 * as `●` produced two identical dots in one colour — a pair that read as noise
 * rather than as "unread" plus "what kind". Each glyph now carries its own
 * silhouette, so kind is legible at a glance and the unread dot is the only
 * round mark in the column.
 *
 * Kept to thin, single-width geometry: heavy arrows (⬇ ⬆) sit visually louder
 * than the titles they annotate and render inconsistently across terminal fonts.
 */
export const NOTIFICATION_KIND_GLYPH: Record<string, string> = {
  "new-episode": "✦",
  "download-complete": "✓",
  "download-failed": "⚠",
  "queue-recovery": "↺",
  "app-update": "↑",
  "app-restart-required": "⟳",
};

export const NOTIFICATION_KIND_LABEL: Record<string, string> = {
  "new-episode": "New episode",
  "download-complete": "Download complete",
  "download-failed": "Download failed",
  "queue-recovery": "Queue recovered",
  "app-update": "Update available",
  "app-restart-required": "Restart required",
};

export function notificationKindGlyph(kind: string): string {
  // Unknown kinds fall back to a small ring, not a filled dot: the filled dot
  // is the unread marker and must stay unique to it.
  return NOTIFICATION_KIND_GLYPH[kind] ?? "◇";
}

export function notificationKindLabel(kind: string): string {
  return NOTIFICATION_KIND_LABEL[kind] ?? "Notification";
}
