import type { KunaiDatabase } from "../sqlite";

/**
 * Rolling archive of calendar schedule items. The release calendar only fetches a
 * forward window, so to show "what aired in the past week" we persist each forward
 * item keyed by (titleId, releaseAt). Once an item's release date passes it can be
 * read back from here. Bounded by pruneBefore so the table never grows unbounded.
 */
export interface CalendarArchiveItemInput {
  readonly titleId: string;
  readonly releaseAt: string;
  readonly mode?: string | null;
  readonly payloadJson: string;
}

interface CalendarArchiveRow {
  readonly payload_json: string;
}

export class CalendarArchiveRepository {
  constructor(private readonly db: KunaiDatabase) {}

  /** Persist (or refresh) archived items. Items without a real releaseAt are skipped. */
  archive(items: readonly CalendarArchiveItemInput[], now = new Date()): void {
    if (items.length === 0) return;
    const archivedAt = now.toISOString();
    const stmt = this.db.query(
      `
        INSERT INTO calendar_archive (title_id, release_at, mode, payload_json, archived_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(title_id, release_at) DO UPDATE SET
          mode = excluded.mode,
          payload_json = excluded.payload_json,
          archived_at = excluded.archived_at
      `,
    );
    for (const item of items) {
      if (!item.releaseAt) continue;
      stmt.run(item.titleId, item.releaseAt, item.mode ?? null, item.payloadJson, archivedAt);
    }
  }

  /** Archived item payloads whose releaseAt falls within [startIso, endIso], oldest first. */
  listInWindow(startIso: string, endIso: string): readonly string[] {
    return this.db
      .query<CalendarArchiveRow, [string, string]>(
        `
          SELECT payload_json FROM calendar_archive
          WHERE release_at >= ? AND release_at <= ?
          ORDER BY release_at ASC
        `,
      )
      .all(startIso, endIso)
      .map((row) => row.payload_json);
  }

  /** Incidental cleanup — drop entries older than the retention window. Returns rows removed. */
  pruneBefore(iso: string): number {
    return this.db.query("DELETE FROM calendar_archive WHERE release_at < ?").run(iso).changes;
  }

  clear(): void {
    this.db.query("DELETE FROM calendar_archive").run();
  }
}
