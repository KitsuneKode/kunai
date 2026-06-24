import type { NotificationRecord } from "@/services/storage/storage-read-models";

import { notificationKindGlyph } from "./notification-kinds";

export type NotificationsTab = "active" | "archive";

export type NotificationRow = {
  readonly dedupKey: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly unread: boolean;
  readonly usePoster: boolean;
  readonly glyph: string;
  readonly posterUrl?: string;
  readonly relativeTime: string;
};

export type NotificationsView = {
  readonly tab: NotificationsTab;
  readonly rows: readonly NotificationRow[];
  readonly page: number;
  readonly totalPages: number;
  readonly isEmpty: boolean;
};

export type BuildNotificationsViewInput = {
  readonly records: readonly NotificationRecord[];
  readonly tab: NotificationsTab;
  readonly page: number;
  readonly pageSize: number;
  readonly now: string;
};

function glyphForKind(kind: string): string {
  if (kind === "new-episode") return "🆕";
  return notificationKindGlyph(kind);
}

function posterUrlOf(record: NotificationRecord): string | undefined {
  if (!record.itemJson) return undefined;
  try {
    const item = JSON.parse(record.itemJson) as { posterUrl?: string; posterPath?: string };
    return item.posterUrl ?? undefined;
  } catch {
    return undefined;
  }
}

function relativeTime(updatedAt: string, now: string): string {
  const deltaMs = Date.parse(now) - Date.parse(updatedAt);
  const mins = Math.max(0, Math.floor(deltaMs / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function buildNotificationsView(input: BuildNotificationsViewInput): NotificationsView {
  const pageSize = Math.max(1, input.pageSize);
  const totalPages = Math.max(1, Math.ceil(input.records.length / pageSize));
  const page = Math.min(Math.max(0, input.page), totalPages - 1);
  const start = page * pageSize;
  const rows = input.records.slice(start, start + pageSize).map((record) => ({
    dedupKey: record.dedupKey,
    kind: record.kind,
    title: record.title,
    body: record.body,
    unread: !record.readAt,
    usePoster: record.kind === "new-episode",
    glyph: glyphForKind(record.kind),
    posterUrl: posterUrlOf(record),
    relativeTime: relativeTime(record.updatedAt, input.now),
  }));
  return { tab: input.tab, rows, page, totalPages, isEmpty: input.records.length === 0 };
}
