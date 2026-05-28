import { randomUUID } from "node:crypto";

import type { KunaiDatabase } from "../sqlite";

export interface PlaylistItem {
  readonly id: string;
  readonly title: string;
  readonly mediaKind: string;
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly priority: number;
  readonly source: string;
  readonly addedAt: string;
  readonly playedAt?: string;
  readonly sessionId: string;
  readonly status: QueueItemStatus;
  readonly queuePosition?: number;
  readonly completedAt?: string;
}

export type QueueSessionStatus = "active" | "recoverable" | "closed" | "expired";
export type QueueItemStatus = "pending" | "played" | "skipped" | "failed";

export interface QueueSessionInput {
  readonly id: string;
  readonly status: QueueSessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
}

export interface QueueSessionRecord extends QueueSessionInput {
  readonly itemCount: number;
}

export interface PlaylistItemInput {
  readonly title: string;
  readonly mediaKind: string;
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly priority?: number;
  readonly queuePosition?: number;
  readonly source: string;
  readonly sessionId: string;
}

interface PlaylistItemRow {
  readonly id: string;
  readonly title: string;
  readonly media_kind: string;
  readonly title_id: string;
  readonly season: number | null;
  readonly episode: number | null;
  readonly absolute_episode: number | null;
  readonly priority: number;
  readonly source: string;
  readonly added_at: string;
  readonly played_at: string | null;
  readonly session_id: string;
  readonly status?: QueueItemStatus;
  readonly queue_position?: number | null;
  readonly completed_at?: string | null;
}

interface QueueSessionRow {
  readonly id: string;
  readonly status: QueueSessionStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
  readonly item_count: number;
}

function mapPlaylistRow(row: PlaylistItemRow): PlaylistItem {
  return {
    id: row.id,
    title: row.title,
    mediaKind: row.media_kind,
    titleId: row.title_id,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    absoluteEpisode: row.absolute_episode ?? undefined,
    priority: row.priority,
    source: row.source,
    addedAt: row.added_at,
    playedAt: row.played_at ?? undefined,
    sessionId: row.session_id,
    status: row.status ?? (row.played_at ? "played" : "pending"),
    queuePosition: row.queue_position ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

function mapQueueSessionRow(row: QueueSessionRow): QueueSessionRecord {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? undefined,
    itemCount: row.item_count,
  };
}

export class PlaylistRepository {
  constructor(private readonly db: KunaiDatabase) {}

  enqueue(input: PlaylistItemInput): PlaylistItem {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .query(
        `INSERT INTO playlist_queue
           (id, title, media_kind, title_id, season, episode, absolute_episode,
            priority, source, added_at, played_at, session_id, status, queue_position, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending', ?, NULL)`,
      )
      .run(
        id,
        input.title,
        input.mediaKind,
        input.titleId,
        input.season ?? null,
        input.episode ?? null,
        input.absoluteEpisode ?? null,
        input.priority ?? 0,
        input.source,
        now,
        input.sessionId,
        input.queuePosition ?? null,
      );

    const row = this.db
      .query<PlaylistItemRow, [string]>("SELECT * FROM playlist_queue WHERE id = ?")
      .get(id);
    if (!row) throw new Error(`Playlist item not found after insert: ${id}`);
    return mapPlaylistRow(row);
  }

  getAll(sessionId: string): PlaylistItem[] {
    return this.db
      .query<PlaylistItemRow, [string]>(
        `SELECT * FROM playlist_queue WHERE session_id = ?
         ORDER BY COALESCE(queue_position, 2147483647) ASC, priority DESC, added_at ASC`,
      )
      .all(sessionId)
      .map(mapPlaylistRow);
  }

  getUnplayed(sessionId: string): PlaylistItem[] {
    return this.db
      .query<PlaylistItemRow, [string]>(
        `SELECT * FROM playlist_queue WHERE session_id = ? AND played_at IS NULL
         ORDER BY COALESCE(queue_position, 2147483647) ASC, priority DESC, added_at ASC`,
      )
      .all(sessionId)
      .map(mapPlaylistRow);
  }

  peekNext(sessionId: string): PlaylistItem | undefined {
    const row = this.db
      .query<PlaylistItemRow, [string]>(
        `SELECT * FROM playlist_queue WHERE session_id = ? AND played_at IS NULL
         ORDER BY COALESCE(queue_position, 2147483647) ASC, priority DESC, added_at ASC LIMIT 1`,
      )
      .get(sessionId);
    return row === null ? undefined : mapPlaylistRow(row);
  }

  markPlayed(id: string): void {
    const now = new Date().toISOString();
    this.db
      .query(
        "UPDATE playlist_queue SET played_at = ?, status = 'played', completed_at = ? WHERE id = ?",
      )
      .run(now, now, id);
  }

  remove(id: string): void {
    this.db.query("DELETE FROM playlist_queue WHERE id = ?").run(id);
  }

  clear(sessionId: string): void {
    this.db.query("DELETE FROM playlist_queue WHERE session_id = ?").run(sessionId);
  }

  clearPlayed(sessionId: string): void {
    this.db
      .query("DELETE FROM playlist_queue WHERE session_id = ? AND played_at IS NOT NULL")
      .run(sessionId);
  }

  countUnplayed(sessionId: string): number {
    const row = this.db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM playlist_queue WHERE session_id = ? AND played_at IS NULL",
      )
      .get(sessionId);
    return row?.count ?? 0;
  }

  getLastActivity(): string | undefined {
    const row = this.db
      .query<{ last_at: string | null }, []>("SELECT MAX(added_at) AS last_at FROM playlist_queue")
      .get();
    return row?.last_at ?? undefined;
  }

  createQueueSession(input: QueueSessionInput): QueueSessionRecord {
    this.db
      .query(
        `INSERT OR REPLACE INTO playback_queue_sessions
           (id, status, created_at, updated_at, closed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.status, input.createdAt, input.updatedAt, input.closedAt ?? null);
    const record = this.getQueueSession(input.id);
    if (!record) throw new Error(`Queue session not found after insert: ${input.id}`);
    return record;
  }

  getQueueSession(id: string): QueueSessionRecord | undefined {
    const row = this.db
      .query<QueueSessionRow, [string]>(
        `SELECT s.*, COUNT(q.id) AS item_count
         FROM playback_queue_sessions s
         LEFT JOIN playlist_queue q ON q.session_id = s.id AND q.status = 'pending'
         WHERE s.id = ?
         GROUP BY s.id`,
      )
      .get(id);
    return row ? mapQueueSessionRow(row) : undefined;
  }

  markQueueSessionRecoverable(id: string, updatedAt: string): void {
    this.db
      .query(
        "UPDATE playback_queue_sessions SET status = 'recoverable', updated_at = ? WHERE id = ? AND status = 'active'",
      )
      .run(updatedAt, id);
  }

  markActiveQueueSessionsRecoverable(exceptSessionId: string, updatedAt: string): number {
    const result = this.db
      .query(
        `UPDATE playback_queue_sessions
         SET status = 'recoverable', updated_at = ?
         WHERE status = 'active'
           AND id != ?
           AND EXISTS (
             SELECT 1 FROM playlist_queue q
             WHERE q.session_id = playback_queue_sessions.id
               AND q.status = 'pending'
           )`,
      )
      .run(updatedAt, exceptSessionId);
    return result.changes;
  }

  closeQueueSession(id: string, closedAt: string): void {
    this.db
      .query(
        "UPDATE playback_queue_sessions SET status = 'closed', updated_at = ?, closed_at = ? WHERE id = ?",
      )
      .run(closedAt, closedAt, id);
  }

  restoreQueueSession(
    sourceSessionId: string,
    targetSessionId: string,
    restoredAt: string,
  ): number {
    const restore = this.db.transaction(() => {
      const result = this.db
        .query(
          `UPDATE playlist_queue
           SET session_id = ?
           WHERE session_id = ?
             AND status = 'pending'`,
        )
        .run(targetSessionId, sourceSessionId);
      this.closeQueueSession(sourceSessionId, restoredAt);
      return result.changes;
    });
    return restore();
  }

  listRecoverableQueueSessions(limit = 5): QueueSessionRecord[] {
    return this.db
      .query<QueueSessionRow, [number]>(
        `SELECT s.*, COUNT(q.id) AS item_count
         FROM playback_queue_sessions s
         LEFT JOIN playlist_queue q ON q.session_id = s.id AND q.status = 'pending'
         WHERE s.status = 'recoverable'
         GROUP BY s.id
         HAVING item_count > 0
         ORDER BY s.updated_at DESC
         LIMIT ?`,
      )
      .all(limit)
      .map(mapQueueSessionRow);
  }
}
