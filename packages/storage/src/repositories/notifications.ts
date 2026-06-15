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
  readonly readAt?: string;
  readonly archivedAt?: string;
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
  readonly read_at: string | null;
  readonly archived_at: string | null;
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
    readAt: row.read_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
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

  listActive(limit = 50, offset = 0): NotificationRecord[] {
    return this.db
      .query<NotificationRow, [number, number]>(
        `SELECT * FROM notifications
         WHERE archived_at IS NULL
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset)
      .map(mapNotificationRow);
  }

  listArchived(limit = 50, offset = 0): NotificationRecord[] {
    return this.db
      .query<NotificationRow, [number, number]>(
        `SELECT * FROM notifications
         WHERE archived_at IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset)
      .map(mapNotificationRow);
  }

  countActive(): number {
    return (
      this.db
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM notifications WHERE archived_at IS NULL",
        )
        .get()?.n ?? 0
    );
  }

  countUnread(): number {
    return (
      this.db
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM notifications WHERE archived_at IS NULL AND read_at IS NULL",
        )
        .get()?.n ?? 0
    );
  }

  markRead(dedupKey: string, now: string): void {
    this.db
      .query("UPDATE notifications SET read_at = ? WHERE dedup_key = ? AND read_at IS NULL")
      .run(now, dedupKey);
  }

  markAllRead(now: string): void {
    this.db
      .query("UPDATE notifications SET read_at = ? WHERE archived_at IS NULL AND read_at IS NULL")
      .run(now);
  }

  archive(dedupKey: string, now: string): void {
    this.db
      .query("UPDATE notifications SET archived_at = ?, updated_at = ? WHERE dedup_key = ?")
      .run(now, now, dedupKey);
  }

  dismissByDedupKey(dedupKey: string, dismissedAt: string): void {
    this.db
      .query("UPDATE notifications SET dismissed_at = ?, updated_at = ? WHERE dedup_key = ?")
      .run(dismissedAt, dismissedAt, dedupKey);
  }

  /**
   * Permanently remove a single notification AND tombstone its dedupKey so a
   * re-derived signal of the same identity does not resurrect it. A genuinely newer
   * episode/session has a different dedupKey and is unaffected.
   */
  deleteByDedupKey(dedupKey: string, now: string = new Date().toISOString()): void {
    this.db.query("DELETE FROM notifications WHERE dedup_key = ?").run(dedupKey);
    this.db
      .query(
        `INSERT INTO notification_suppressions (dedup_key, suppressed_at)
         VALUES (?, ?)
         ON CONFLICT(dedup_key) DO UPDATE SET suppressed_at = excluded.suppressed_at`,
      )
      .run(dedupKey, now);
  }

  /** Dedup keys the user explicitly deleted; recordSignals must not recreate them. */
  listSuppressedKeys(): ReadonlySet<string> {
    const rows = this.db
      .query<{ dedup_key: string }, []>("SELECT dedup_key FROM notification_suppressions")
      .all();
    return new Set(rows.map((row) => row.dedup_key));
  }

  /** Permanently remove every notification of a kind (e.g. refresh ephemeral queue-recovery). */
  deleteByKind(kind: string): number {
    const before = this.db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM notifications WHERE kind = ?")
      .get(kind);
    this.db.query("DELETE FROM notifications WHERE kind = ?").run(kind);
    return before?.n ?? 0;
  }

  /** Permanently remove every archived notification (cleanup of the Archive tab). */
  clearArchived(): number {
    const before = this.db
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM notifications WHERE archived_at IS NOT NULL",
      )
      .get();
    this.db.query("DELETE FROM notifications WHERE archived_at IS NOT NULL").run();
    return before?.n ?? 0;
  }
}
