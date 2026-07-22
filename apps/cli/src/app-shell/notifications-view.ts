import { parseNotificationMediaItem } from "@/services/notifications/NotificationActionRouter";
import type { NotificationRecord } from "@/services/storage/storage-read-models";

import { notificationKindGlyph, notificationKindLabel } from "./notification-kinds";
import {
  getExecutableNotificationActions,
  getNotificationActionPresentation,
  getNotificationPrimaryAction,
  getNotificationTone,
  type NotificationActionPresentation,
} from "./notification-overlay-model";
import type { PreviewFact, PreviewRailModel } from "./primitives/PreviewRail.model";
import type { ShellStatusTone } from "./types";

export type NotificationsTab = "active" | "archive";

export type NotificationsSortMode = "attention" | "newest" | "type";

export const NOTIFICATION_SORT_MODES_BY_TAB = {
  active: ["attention", "newest", "type"],
  archive: ["newest", "type"],
} as const satisfies Readonly<Record<NotificationsTab, readonly NotificationsSortMode[]>>;

export function getDefaultNotificationsSortMode(tab: NotificationsTab): NotificationsSortMode {
  return tab === "active" ? "attention" : "newest";
}

export function cycleNotificationsSortMode(
  tab: NotificationsTab,
  current: NotificationsSortMode,
): NotificationsSortMode {
  const modes: readonly NotificationsSortMode[] = NOTIFICATION_SORT_MODES_BY_TAB[tab];
  const currentIndex = modes.indexOf(current);
  return modes[(currentIndex + 1 + modes.length) % modes.length] ?? modes[0] ?? "newest";
}

export type NotificationRow = {
  readonly dedupKey: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly glyph: string;
  readonly tone: ShellStatusTone;
  readonly title: string;
  readonly body: string;
  readonly unread: boolean;
  readonly actionable: boolean;
  readonly primaryAction: NotificationActionPresentation;
  readonly posterUrl?: string;
  readonly relativeTime: string;
};

export type NotificationRailView = {
  readonly dedupKey: string;
  readonly kindLabel: string;
  readonly glyph: string;
  readonly tone: ShellStatusTone;
  readonly unread: boolean;
  readonly relativeTime: string;
  readonly preview: PreviewRailModel;
  readonly primaryAction: NotificationActionPresentation & { readonly key: "enter" };
  readonly secondaryActions: readonly NotificationActionPresentation[];
  readonly lifecycleHints: readonly { readonly key: string; readonly label: string }[];
};

export type NotificationsView = {
  readonly tab: NotificationsTab;
  readonly tabLabel: "Active" | "Archive";
  readonly sortMode: NotificationsSortMode;
  readonly sortLabel: "Needs attention" | "Newest" | "Type";
  readonly rows: readonly NotificationRow[];
  readonly orderedDedupKeys: readonly string[];
  readonly selectedIndex: number;
  readonly selectedRow: NotificationRow | null;
  readonly rail: NotificationRailView | null;
  readonly page: number;
  readonly totalPages: number;
  readonly isEmpty: boolean;
  readonly emptyTitle: string;
};

export type BuildNotificationsViewInput = {
  readonly records: readonly NotificationRecord[];
  readonly tab: NotificationsTab;
  readonly sortMode: NotificationsSortMode;
  readonly page: number;
  readonly pageSize: number;
  readonly selectedDedupKey: string | null;
  readonly now: string;
  /** Optional poster lookup by titleId (e.g. from watch history). */
  readonly resolvePosterUrl?: (titleId: string) => string | undefined;
};

const TMDB_POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342";

function httpsPosterUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function toPosterUrl(posterPath: string | null | undefined): string | undefined {
  if (!posterPath) return undefined;
  if (/^https?:\/\//i.test(posterPath)) return httpsPosterUrl(posterPath);
  if (posterPath.startsWith("/")) return `${TMDB_POSTER_BASE_URL}${posterPath}`;
  return undefined;
}

function posterUrlOf(
  record: NotificationRecord,
  resolvePosterUrl?: (titleId: string) => string | undefined,
): string | undefined {
  if (record.itemJson) {
    try {
      const parsed = JSON.parse(record.itemJson) as {
        posterUrl?: unknown;
        posterPath?: unknown;
        titleId?: unknown;
      };
      if (typeof parsed.posterUrl === "string") {
        const fromUrl = httpsPosterUrl(parsed.posterUrl);
        if (fromUrl) return fromUrl;
      }
      if (typeof parsed.posterPath === "string") {
        const fromPath = toPosterUrl(parsed.posterPath);
        if (fromPath) return fromPath;
      }
      if (typeof parsed.titleId === "string" && resolvePosterUrl) {
        const resolved = resolvePosterUrl(parsed.titleId);
        if (resolved) return httpsPosterUrl(resolved) ?? resolved;
      }
    } catch {
      // fall through
    }
  }
  const media = parseNotificationMediaItem(record);
  if (media?.titleId && resolvePosterUrl) {
    const resolved = resolvePosterUrl(media.titleId);
    if (resolved) return httpsPosterUrl(resolved) ?? resolved;
  }
  return undefined;
}

/** Attention groups: recover/repair first, then new content, updates, receipts, unknown. */
const TYPE_GROUP: Readonly<Record<string, number>> = {
  "queue-recovery": 0,
  "download-failed": 0,
  "new-episode": 1,
  "app-update": 2,
  "app-restart-required": 2,
  "download-complete": 3,
};

type NotificationSortEntry = {
  readonly record: NotificationRecord;
  readonly updatedAtMs: number;
  readonly attentionTier: number;
  readonly typeGroup: number;
};

function compareNewest(a: NotificationSortEntry, b: NotificationSortEntry): number {
  const byTime = b.updatedAtMs - a.updatedAtMs;
  return byTime !== 0 ? byTime : a.record.dedupKey.localeCompare(b.record.dedupKey);
}

function sortRecords(
  records: readonly NotificationRecord[],
  mode: NotificationsSortMode,
): NotificationRecord[] {
  const entries = records.map(
    (record): NotificationSortEntry => ({
      record,
      updatedAtMs: Date.parse(record.updatedAt),
      attentionTier: record.readAt ? 2 : getNotificationPrimaryAction(record) === "dismiss" ? 1 : 0,
      typeGroup: TYPE_GROUP[record.kind] ?? 4,
    }),
  );

  entries.sort((a, b) => {
    if (mode === "attention") {
      const byTier = a.attentionTier - b.attentionTier;
      return byTier !== 0 ? byTier : compareNewest(a, b);
    }
    if (mode === "type") {
      const byGroup = a.typeGroup - b.typeGroup;
      return byGroup !== 0 ? byGroup : compareNewest(a, b);
    }
    return compareNewest(a, b);
  });
  return entries.map((entry) => entry.record);
}

function relativeTime(updatedAt: string, now: string): string {
  const deltaMs = Date.parse(now) - Date.parse(updatedAt);
  const mins = Math.max(0, Math.floor(deltaMs / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function toRow(
  record: NotificationRecord,
  now: string,
  resolvePosterUrl?: (titleId: string) => string | undefined,
): NotificationRow {
  const primaryAction = getNotificationActionPresentation(getNotificationPrimaryAction(record));
  return {
    dedupKey: record.dedupKey,
    kind: record.kind,
    kindLabel: notificationKindLabel(record.kind),
    glyph: notificationKindGlyph(record.kind),
    tone: getNotificationTone(record.kind),
    title: record.title,
    body: record.body,
    unread: !record.readAt,
    actionable: primaryAction.id !== "dismiss",
    primaryAction,
    posterUrl: posterUrlOf(record, resolvePosterUrl),
    relativeTime: relativeTime(record.updatedAt, now),
  };
}

function mediaFacts(record: NotificationRecord): readonly PreviewFact[] {
  const media = parseNotificationMediaItem(record);
  if (!media) return [];
  const episode =
    media.episode !== undefined
      ? media.season !== undefined
        ? `S${String(media.season).padStart(2, "0")}E${String(media.episode).padStart(2, "0")}`
        : `E${String(media.episode).padStart(2, "0")}`
      : media.absoluteEpisode !== undefined
        ? `E${String(media.absoluteEpisode).padStart(2, "0")}`
        : media.mediaKind === "movie"
          ? "Movie"
          : undefined;
  const provider = media.providerHints?.[0]?.providerId;
  return [
    ...(episode ? [{ label: "Episode", value: episode }] : []),
    ...(provider ? [{ label: "Provider", value: provider }] : []),
  ];
}

function toRail(
  record: NotificationRecord,
  row: NotificationRow,
  tab: NotificationsTab,
): NotificationRailView {
  const secondaryActions = getExecutableNotificationActions(record)
    .filter((action) => action !== row.primaryAction.id && action !== "dismiss")
    .map(getNotificationActionPresentation);

  const preview: PreviewRailModel = {
    title: record.title,
    subtitle: row.kindLabel,
    overview: record.body,
    posterUrl: row.posterUrl,
    posterState: "none",
    facts: [
      { label: "Kind", value: row.kindLabel },
      { label: "Status", value: row.unread ? "Unread" : "Read" },
      { label: "When", value: row.relativeTime },
      ...mediaFacts(record),
    ],
  };

  const lifecycleHints =
    tab === "active"
      ? [
          { key: "r", label: "mark read" },
          { key: "x", label: "archive" },
          { key: "d", label: "delete" },
        ]
      : [
          { key: "d", label: "delete" },
          { key: "C", label: "clear archive" },
        ];

  return {
    dedupKey: row.dedupKey,
    kindLabel: row.kindLabel,
    glyph: row.glyph,
    tone: row.tone,
    unread: row.unread,
    relativeTime: row.relativeTime,
    preview,
    primaryAction: { ...row.primaryAction, key: "enter" },
    secondaryActions,
    lifecycleHints,
  };
}

export function nearestNotificationDedupKey(
  orderedDedupKeys: readonly string[],
  removedDedupKey: string,
): string | null {
  const index = orderedDedupKeys.indexOf(removedDedupKey);
  if (index < 0) return null;
  return orderedDedupKeys[index + 1] ?? orderedDedupKeys[index - 1] ?? null;
}

export function buildNotificationsView(input: BuildNotificationsViewInput): NotificationsView {
  const pageSize = Math.max(1, input.pageSize);
  const orderedRecords = sortRecords(input.records, input.sortMode);
  const orderedDedupKeys = orderedRecords.map((record) => record.dedupKey);
  const totalPages = Math.max(1, Math.ceil(orderedRecords.length / pageSize));

  const selectedGlobalIndex = input.selectedDedupKey
    ? orderedRecords.findIndex((record) => record.dedupKey === input.selectedDedupKey)
    : -1;
  const requestedPage = Math.min(Math.max(0, input.page), totalPages - 1);
  const page =
    selectedGlobalIndex >= 0 ? Math.floor(selectedGlobalIndex / pageSize) : requestedPage;

  const start = page * pageSize;
  const pageRecords = orderedRecords.slice(start, start + pageSize);
  const rows = pageRecords.map((record) => toRow(record, input.now, input.resolvePosterUrl));

  const selectedIndex =
    selectedGlobalIndex >= 0 ? selectedGlobalIndex - start : rows.length > 0 ? 0 : -1;
  const selectedRow = selectedIndex >= 0 ? (rows[selectedIndex] ?? null) : null;
  const selectedRecord = selectedIndex >= 0 ? (pageRecords[selectedIndex] ?? null) : null;

  return {
    tab: input.tab,
    tabLabel: input.tab === "active" ? "Active" : "Archive",
    sortMode: input.sortMode,
    sortLabel:
      input.sortMode === "attention"
        ? "Needs attention"
        : input.sortMode === "newest"
          ? "Newest"
          : "Type",
    rows,
    orderedDedupKeys,
    selectedIndex,
    selectedRow,
    rail: selectedRecord && selectedRow ? toRail(selectedRecord, selectedRow, input.tab) : null,
    page,
    totalPages,
    isEmpty: orderedRecords.length === 0,
    emptyTitle: input.tab === "active" ? "You're all caught up." : "No archived notifications.",
  };
}
