import type { KunaiDatabase } from "../sqlite";

export type FollowedTitlePreference = "implicit" | "following" | "muted";

export interface FollowedTitleRecord {
  readonly titleId: string;
  readonly mediaKind: string;
  readonly title: string;
  readonly preference: FollowedTitlePreference;
  readonly updatedAt: string;
}

interface FollowedTitleRow {
  readonly title_id: string;
  readonly media_kind: string;
  readonly title: string;
  readonly preference: FollowedTitlePreference;
  readonly updated_at: string;
}

function mapFollowedTitleRow(row: FollowedTitleRow): FollowedTitleRecord {
  return {
    titleId: row.title_id,
    mediaKind: row.media_kind,
    title: row.title,
    preference: row.preference,
    updatedAt: row.updated_at,
  };
}

export class FollowedTitleRepository {
  constructor(private readonly db: KunaiDatabase) {}

  upsert(input: FollowedTitleRecord): FollowedTitleRecord {
    this.db
      .query(
        `INSERT INTO followed_titles (title_id, media_kind, title, preference, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(title_id) DO UPDATE SET
           media_kind = excluded.media_kind,
           title = excluded.title,
           preference = excluded.preference,
           updated_at = excluded.updated_at`,
      )
      .run(input.titleId, input.mediaKind, input.title, input.preference, input.updatedAt);
    const row = this.get(input.titleId);
    if (!row) throw new Error(`Followed title not found after upsert: ${input.titleId}`);
    return row;
  }

  get(titleId: string): FollowedTitleRecord | undefined {
    const row = this.db
      .query<FollowedTitleRow, [string]>("SELECT * FROM followed_titles WHERE title_id = ?")
      .get(titleId);
    return row ? mapFollowedTitleRow(row) : undefined;
  }

  listByPreference(preference: FollowedTitlePreference): FollowedTitleRecord[] {
    return this.db
      .query<FollowedTitleRow, [FollowedTitlePreference]>(
        "SELECT * FROM followed_titles WHERE preference = ? ORDER BY updated_at DESC",
      )
      .all(preference)
      .map(mapFollowedTitleRow);
  }
}
