import type { KunaiDatabase } from "../sqlite";

export interface UserPlaylistRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserPlaylistItemRecord {
  readonly id: string;
  readonly playlistId: string;
  readonly titleId: string;
  readonly mediaKind: string;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly sortOrder: number;
  readonly providerHintsJson?: string;
  readonly notes?: string;
  readonly addedAt: string;
}

interface UserPlaylistRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface UserPlaylistItemRow {
  readonly id: string;
  readonly playlist_id: string;
  readonly title_id: string;
  readonly media_kind: string;
  readonly title: string;
  readonly season: number | null;
  readonly episode: number | null;
  readonly absolute_episode: number | null;
  readonly sort_order: number;
  readonly provider_hints_json: string | null;
  readonly notes: string | null;
  readonly added_at: string;
}

function mapPlaylistRow(row: UserPlaylistRow): UserPlaylistRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPlaylistItemRow(row: UserPlaylistItemRow): UserPlaylistItemRecord {
  return {
    id: row.id,
    playlistId: row.playlist_id,
    titleId: row.title_id,
    mediaKind: row.media_kind,
    title: row.title,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    absoluteEpisode: row.absolute_episode ?? undefined,
    sortOrder: row.sort_order,
    providerHintsJson: row.provider_hints_json ?? undefined,
    notes: row.notes ?? undefined,
    addedAt: row.added_at,
  };
}

export class PlaylistsRepository {
  constructor(private readonly db: KunaiDatabase) {}

  create(input: UserPlaylistRecord): UserPlaylistRecord {
    this.db
      .query(
        `INSERT INTO user_playlists (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.name, input.description ?? null, input.createdAt, input.updatedAt);
    const row = this.get(input.id);
    if (!row) throw new Error(`Playlist not found after create: ${input.id}`);
    return row;
  }

  get(id: string): UserPlaylistRecord | undefined {
    const row = this.db
      .query<UserPlaylistRow, [string]>("SELECT * FROM user_playlists WHERE id = ?")
      .get(id);
    return row ? mapPlaylistRow(row) : undefined;
  }

  list(): UserPlaylistRecord[] {
    return this.db
      .query<UserPlaylistRow, []>("SELECT * FROM user_playlists ORDER BY updated_at DESC")
      .all()
      .map(mapPlaylistRow);
  }

  addItem(input: UserPlaylistItemRecord): UserPlaylistItemRecord {
    this.db
      .query(
        `INSERT INTO user_playlist_items
           (id, playlist_id, title_id, media_kind, title, season, episode, absolute_episode,
            sort_order, provider_hints_json, notes, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.playlistId,
        input.titleId,
        input.mediaKind,
        input.title,
        input.season ?? null,
        input.episode ?? null,
        input.absoluteEpisode ?? null,
        input.sortOrder,
        input.providerHintsJson ?? null,
        input.notes ?? null,
        input.addedAt,
      );
    const row = this.listItems(input.playlistId).find((item) => item.id === input.id);
    if (!row) throw new Error(`Playlist item not found after add: ${input.id}`);
    return row;
  }

  listItems(playlistId: string): UserPlaylistItemRecord[] {
    return this.db
      .query<UserPlaylistItemRow, [string]>(
        `SELECT * FROM user_playlist_items
         WHERE playlist_id = ?
         ORDER BY sort_order ASC, added_at ASC`,
      )
      .all(playlistId)
      .map(mapPlaylistItemRow);
  }
}
