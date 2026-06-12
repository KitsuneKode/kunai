import type { KunaiDatabase } from "../sqlite";

export interface NotificationRecord {
  readonly id: string;
  readonly dedupKey: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly itemJson?: string;
  readonly actionJson?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dismissedAt?: string;
}

export interface NotificationInput {
  readonly dedupKey: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly itemJson?: string;
  readonly actionJson?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface NotificationRow {
  readonly id: string;
  readonly dedup_key: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly item_json: string | null;
  readonly action_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly dismissed_at: string | null;
}

function mapNotificationRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    dedupKey: row.dedup_key,
    kind: row.kind,
    title: row.title,
    body: row.body,
    itemJson: row.item_json ?? undefined,
    actionJson: row.action_json ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dismissedAt: row.dismissed_at ?? undefined,
  };
}

export class NotificationRepository {
  constructor(private readonly db: KunaiDatabase) {}

  upsert(input: NotificationInput): NotificationRecord {
    const existing = this.getByDedupKey(input.dedupKey);
    const id = existing?.id ?? crypto.randomUUID();
    this.db
      .query(
        `INSERT INTO notifications
           (id, dedup_key, kind, title, body, item_json, action_json, created_at, updated_at, dismissed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(dedup_key) DO UPDATE SET
           kind = excluded.kind,
           title = excluded.title,
           body = excluded.body,
           item_json = excluded.item_json,
           action_json = excluded.action_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.dedupKey,
        input.kind,
        input.title,
        input.body,
        input.itemJson ?? null,
        input.actionJson ?? null,
        input.createdAt,
        input.updatedAt,
      );
    const row = this.getByDedupKey(input.dedupKey);
    if (!row) throw new Error(`Notification not found after upsert: ${input.dedupKey}`);
    return row;
  }

  getByDedupKey(dedupKey: string): NotificationRecord | undefined {
    const row = this.db
      .query<NotificationRow, [string]>("SELECT * FROM notifications WHERE dedup_key = ?")
      .get(dedupKey);
    return row ? mapNotificationRow(row) : undefined;
  }

  listActive(limit = 50): NotificationRecord[] {
    return this.db
      .query<NotificationRow, [number]>(
        `SELECT * FROM notifications
         WHERE dismissed_at IS NULL
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(limit)
      .map(mapNotificationRow);
  }

  dismissByDedupKey(dedupKey: string, dismissedAt: string): void {
    this.db
      .query("UPDATE notifications SET dismissed_at = ?, updated_at = ? WHERE dedup_key = ?")
      .run(dismissedAt, dismissedAt, dedupKey);
  }
}
