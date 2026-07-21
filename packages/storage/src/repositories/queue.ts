import type { KunaiDatabase } from "../sqlite";

export type QueueItemStatus = "pending" | "in-flight" | "played" | "skipped" | "failed";

export interface QueuePlaybackFailureRecord {
  readonly code:
    | "search-cancelled"
    | "episode-cancelled"
    | "provider-exhausted"
    | "mpv-launch-failed"
    | "playback-aborted"
    | "handoff-failed";
  readonly stage: "handoff" | "episode-selection" | "provider-resolution" | "player-launch";
  readonly at: string;
  readonly detail?: string;
}

export interface QueueEntry {
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
  readonly inFlightAt?: string;
  readonly lastFailure?: QueuePlaybackFailureRecord;
}

export type QueueSessionStatus = "active" | "recoverable" | "closed" | "expired";

export interface QueueSessionInput {
  readonly id: string;
  readonly status: QueueSessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
  readonly lastActivityAt?: string;
}

export interface QueueSessionRecord extends QueueSessionInput {
  readonly itemCount: number;
}

export interface QueueEntryInput {
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

interface QueueEntryRow {
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
  readonly in_flight_at?: string | null;
  readonly last_failure_json?: string | null;
}

interface QueueSessionRow {
  readonly id: string;
  readonly status: QueueSessionStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
  readonly last_activity_at?: string | null;
  readonly item_count: number;
}

const FAILURE_CODES = new Set<QueuePlaybackFailureRecord["code"]>([
  "search-cancelled",
  "episode-cancelled",
  "provider-exhausted",
  "mpv-launch-failed",
  "playback-aborted",
  "handoff-failed",
]);

const FAILURE_STAGES = new Set<QueuePlaybackFailureRecord["stage"]>([
  "handoff",
  "episode-selection",
  "provider-resolution",
  "player-launch",
]);

function parseFailureRecord(
  raw: string | null | undefined,
): QueuePlaybackFailureRecord | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.code !== "string" ||
      !FAILURE_CODES.has(record.code as QueuePlaybackFailureRecord["code"])
    ) {
      return undefined;
    }
    if (
      typeof record.stage !== "string" ||
      !FAILURE_STAGES.has(record.stage as QueuePlaybackFailureRecord["stage"])
    ) {
      return undefined;
    }
    if (typeof record.at !== "string") return undefined;
    return {
      code: record.code as QueuePlaybackFailureRecord["code"],
      stage: record.stage as QueuePlaybackFailureRecord["stage"],
      at: record.at,
      ...(typeof record.detail === "string" ? { detail: record.detail } : {}),
    };
  } catch {
    return undefined;
  }
}

function mapQueueRow(row: QueueEntryRow): QueueEntry {
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
    inFlightAt: row.in_flight_at ?? undefined,
    lastFailure: parseFailureRecord(row.last_failure_json),
  };
}

function mapQueueSessionRow(row: QueueSessionRow): QueueSessionRecord {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? undefined,
    lastActivityAt: row.last_activity_at ?? undefined,
    itemCount: row.item_count,
  };
}

export class QueueRepository {
  constructor(private readonly db: KunaiDatabase) {}

  enqueue(input: QueueEntryInput): QueueEntry {
    const id = crypto.randomUUID();
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

    this.touchSessionActivity(input.sessionId, now);

    const row = this.db
      .query<QueueEntryRow, [string]>("SELECT * FROM playlist_queue WHERE id = ?")
      .get(id);
    if (!row) throw new Error(`Playlist item not found after insert: ${id}`);
    return mapQueueRow(row);
  }

  getById(id: string): QueueEntry | undefined {
    const row = this.db
      .query<QueueEntryRow, [string]>("SELECT * FROM playlist_queue WHERE id = ?")
      .get(id);
    return row ? mapQueueRow(row) : undefined;
  }

  getAll(sessionId: string): QueueEntry[] {
    return this.db
      .query<QueueEntryRow, [string]>(
        `SELECT * FROM playlist_queue WHERE session_id = ?
         ORDER BY COALESCE(queue_position, 2147483647) ASC, priority DESC, added_at ASC`,
      )
      .all(sessionId)
      .map(mapQueueRow);
  }

  getAllForSession(sessionId: string): QueueEntry[] {
    return this.getAll(sessionId);
  }

  getUnplayed(sessionId: string): QueueEntry[] {
    return this.db
      .query<QueueEntryRow, [string]>(
        `SELECT * FROM playlist_queue WHERE session_id = ? AND played_at IS NULL
         ORDER BY COALESCE(queue_position, 2147483647) ASC, priority DESC, added_at ASC`,
      )
      .all(sessionId)
      .map(mapQueueRow);
  }

  peekNext(sessionId: string): QueueEntry | undefined {
    const row = this.db
      .query<QueueEntryRow, [string]>(
        `SELECT * FROM playlist_queue WHERE session_id = ? AND played_at IS NULL
         ORDER BY COALESCE(queue_position, 2147483647) ASC, priority DESC, added_at ASC LIMIT 1`,
      )
      .get(sessionId);
    return row === null ? undefined : mapQueueRow(row);
  }

  markPlayed(id: string): void {
    const now = new Date().toISOString();
    this.db
      .query(
        "UPDATE playlist_queue SET played_at = ?, status = 'played', completed_at = ? WHERE id = ?",
      )
      .run(now, now, id);
  }

  /**
   * Claim a pending row for playback handoff.
   * Compare-and-set: only succeeds when id+session are pending.
   */
  markInFlight(id: string, sessionId: string, at: string): boolean {
    const result = this.db
      .query(
        `UPDATE playlist_queue
         SET status = 'in-flight', in_flight_at = ?, last_failure_json = NULL
         WHERE id = ? AND session_id = ? AND status = 'pending'`,
      )
      .run(at, id, sessionId);
    if (result.changes === 0) return false;
    this.touchSessionActivity(sessionId, at);
    return true;
  }

  /**
   * Acknowledge confirmed playback startup (`playback-started`).
   * Compare-and-set: only the exact in-flight row transitions to played.
   */
  acknowledgePlaybackStarted(id: string, sessionId: string, at: string): boolean {
    const result = this.db
      .query(
        `UPDATE playlist_queue
         SET status = 'played', played_at = ?, completed_at = ?
         WHERE id = ? AND session_id = ? AND status = 'in-flight'`,
      )
      .run(at, at, id, sessionId);
    if (result.changes === 0) return false;
    this.touchSessionActivity(sessionId, at);
    return true;
  }

  /**
   * Pre-start failure: restore the exact in-flight row to pending with failure context.
   * Preserves queue_position so the item stays in place.
   */
  restoreInFlightToPending(
    id: string,
    sessionId: string,
    failure: QueuePlaybackFailureRecord,
  ): boolean {
    const result = this.db
      .query(
        `UPDATE playlist_queue
         SET status = 'pending', in_flight_at = NULL, last_failure_json = ?
         WHERE id = ? AND session_id = ? AND status = 'in-flight'`,
      )
      .run(JSON.stringify(failure), id, sessionId);
    if (result.changes === 0) return false;
    this.touchSessionActivity(sessionId, failure.at);
    return true;
  }

  remove(id: string): void {
    this.db.query("DELETE FROM playlist_queue WHERE id = ?").run(id);
  }

  clear(sessionId: string): void {
    this.db.query("DELETE FROM playlist_queue WHERE session_id = ?").run(sessionId);
  }

  /** Persist an explicit ordering — assigns queue_position = index for each id in order. */
  setQueuePositions(orderedIds: readonly string[]): void {
    const stmt = this.db.query("UPDATE playlist_queue SET queue_position = ? WHERE id = ?");
    orderedIds.forEach((id, index) => stmt.run(index, id));
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
    const lastActivityAt = input.lastActivityAt ?? input.updatedAt;
    this.db
      .query(
        `INSERT OR REPLACE INTO playback_queue_sessions
           (id, status, created_at, updated_at, closed_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.status,
        input.createdAt,
        input.updatedAt,
        input.closedAt ?? null,
        lastActivityAt,
      );
    const record = this.getQueueSession(input.id);
    if (!record) throw new Error(`Queue session not found after insert: ${input.id}`);
    return record;
  }

  getQueueSession(id: string): QueueSessionRecord | undefined {
    const row = this.db
      .query<QueueSessionRow, [string]>(
        `SELECT s.*, COUNT(q.id) AS item_count
         FROM playback_queue_sessions s
         LEFT JOIN playlist_queue q ON q.session_id = s.id AND q.status IN ('pending', 'in-flight')
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
               AND q.status IN ('pending', 'in-flight')
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
  ): string[] {
    const restore = this.db.transaction(() => {
      const currentEntries = this.getAll(targetSessionId);
      const currentPlayed = currentEntries.filter((entry) => entry.status === "played");
      const currentPending = currentEntries.filter((entry) => entry.status !== "played");

      // Reset in-flight rows back to pending so restored work is claimable again.
      this.db
        .query(
          `UPDATE playlist_queue
           SET status = 'pending', in_flight_at = NULL
           WHERE session_id = ?
             AND status = 'in-flight'`,
        )
        .run(sourceSessionId);

      const restoredEntries = this.getAll(sourceSessionId).filter(
        (entry) => entry.status === "pending",
      );
      const restoredIds = restoredEntries.map((entry) => entry.id);
      if (restoredIds.length === 0) {
        this.closeQueueSession(sourceSessionId, restoredAt);
        return restoredIds;
      }

      this.db
        .query(
          `UPDATE playlist_queue
           SET session_id = ?
           WHERE session_id = ?
             AND status = 'pending'`,
        )
        .run(targetSessionId, sourceSessionId);

      this.setQueuePositions([
        ...currentPlayed.map((entry) => entry.id),
        ...restoredIds,
        ...currentPending.map((entry) => entry.id),
      ]);
      this.closeQueueSession(sourceSessionId, restoredAt);
      return restoredIds;
    });
    return restore();
  }

  listRecoverableQueueSessions(limit = 5): QueueSessionRecord[] {
    return this.db
      .query<QueueSessionRow, [number]>(
        `SELECT s.*, COUNT(q.id) AS item_count
         FROM playback_queue_sessions s
         LEFT JOIN playlist_queue q ON q.session_id = s.id AND q.status IN ('pending', 'in-flight')
         WHERE s.status = 'recoverable'
         GROUP BY s.id
         HAVING item_count > 0
         ORDER BY COALESCE(s.last_activity_at, s.updated_at) DESC
         LIMIT ?`,
      )
      .all(limit)
      .map(mapQueueSessionRow);
  }

  private touchSessionActivity(sessionId: string, at: string): void {
    this.db
      .query(
        `UPDATE playback_queue_sessions
         SET last_activity_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(at, at, sessionId);
  }
}
