// Pure toast selector. Given the active notifications (newest first, as
// listActive returns ORDER BY updated_at DESC) and the set of dedupKeys already
// seen, pick the newest unseen one as a transient toast string. The returned
// seenKeys = every current active key, so deletions can't resurrect a toast.

export type NotificationToastItem = {
  readonly dedupKey: string;
  readonly kind: string;
  readonly title: string;
};

export type NotificationToastInput = {
  readonly active: readonly NotificationToastItem[];
  readonly seenKeys: ReadonlySet<string>;
};

export type NotificationToastResult = {
  readonly toast: string | null;
  readonly seenKeys: ReadonlySet<string>;
};

const KIND_GLYPH: Record<string, string> = {
  "new-episode": "●",
  "download-complete": "⬇",
  "download-failed": "⚠",
  "queue-recovery": "↩",
  "app-update": "⬆",
};

const KIND_LABEL: Record<string, string> = {
  "new-episode": "New episode",
  "download-complete": "Download complete",
  "download-failed": "Download failed",
  "queue-recovery": "Queue recovered",
  "app-update": "Update available",
};

export function selectNotificationToast(input: NotificationToastInput): NotificationToastResult {
  const seenKeys = new Set(input.active.map((a) => a.dedupKey));
  const firstNew = input.active.find((a) => !input.seenKeys.has(a.dedupKey));
  if (!firstNew) return { toast: null, seenKeys };
  const glyph = KIND_GLYPH[firstNew.kind] ?? "●";
  const label = KIND_LABEL[firstNew.kind] ?? "Notification";
  return { toast: `${glyph} ${label} — ${firstNew.title}`, seenKeys };
}
