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
}

export interface PlaylistItemInput {
  readonly title: string;
  readonly mediaKind: string;
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly priority?: number;
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
            priority, source, added_at, played_at, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
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
         ORDER BY priority DESC, added_at ASC`,
      )
      .all(sessionId)
      .map(mapPlaylistRow);
  }

  getUnplayed(sessionId: string): PlaylistItem[] {
    return this.db
      .query<PlaylistItemRow, [string]>(
        `SELECT * FROM playlist_queue WHERE session_id = ? AND played_at IS NULL
         ORDER BY priority DESC, added_at ASC`,
      )
      .all(sessionId)
      .map(mapPlaylistRow);
  }

  peekNext(sessionId: string): PlaylistItem | undefined {
    const row = this.db
      .query<PlaylistItemRow, [string]>(
        `SELECT * FROM playlist_queue WHERE session_id = ? AND played_at IS NULL
         ORDER BY priority DESC, added_at ASC LIMIT 1`,
      )
      .get(sessionId);
    return row === null ? undefined : mapPlaylistRow(row);
  }

  markPlayed(id: string): void {
    const now = new Date().toISOString();
    this.db.query("UPDATE playlist_queue SET played_at = ? WHERE id = ?").run(now, id);
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
}
