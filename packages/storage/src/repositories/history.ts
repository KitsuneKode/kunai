import type { EpisodeIdentity, MediaKind, ProviderId, TitleIdentity } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

export interface HistoryProgressInput {
  readonly title: TitleIdentity;
  readonly episode?: EpisodeIdentity;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly completed?: boolean;
  readonly providerId?: ProviderId;
  readonly updatedAt?: string;
}

export interface HistoryProgress {
  readonly key: string;
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly completed: boolean;
  readonly providerId?: ProviderId;
  readonly updatedAt: string;
  readonly createdAt: string;
}

interface HistoryProgressRow {
  readonly key: string;
  readonly title_id: string;
  readonly media_kind: MediaKind;
  readonly title: string;
  readonly season: number | null;
  readonly episode: number | null;
  readonly absolute_episode: number | null;
  readonly position_seconds: number;
  readonly duration_seconds: number | null;
  readonly completed: number;
  readonly provider_id: string | null;
  readonly updated_at: string;
  readonly created_at: string;
}

export class HistoryRepository {
  constructor(private readonly db: KunaiDatabase) {}

  upsertProgress(input: HistoryProgressInput): void {
    const key = createHistoryKey(input.title, input.episode);
    const now = input.updatedAt ?? new Date().toISOString();

    this.db
      .query(
        `
          INSERT INTO history_progress (
            key,
            title_id,
            media_kind,
            title,
            season,
            episode,
            absolute_episode,
            position_seconds,
            duration_seconds,
            completed,
            provider_id,
            updated_at,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            title = excluded.title,
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            completed = excluded.completed,
            provider_id = excluded.provider_id,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        key,
        input.title.id,
        input.title.kind,
        input.title.title,
        input.episode?.season ?? null,
        input.episode?.episode ?? null,
        input.episode?.absoluteEpisode ?? null,
        Math.max(0, Math.trunc(input.positionSeconds)),
        input.durationSeconds === undefined ? null : Math.max(0, Math.trunc(input.durationSeconds)),
        input.completed === true ? 1 : 0,
        input.providerId ?? null,
        now,
        now,
      );
  }

  getProgress(title: TitleIdentity, episode?: EpisodeIdentity): HistoryProgress | undefined {
    const row = this.db
      .query<HistoryProgressRow, [string]>("SELECT * FROM history_progress WHERE key = ?")
      .get(createHistoryKey(title, episode));

    return row === null ? undefined : mapHistoryRow(row);
  }

  getLatestForTitle(titleId: string): HistoryProgress | undefined {
    const row = this.db
      .query<HistoryProgressRow, [string]>(
        "SELECT * FROM history_progress WHERE title_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(titleId);

    return row === null ? undefined : mapHistoryRow(row);
  }

  listRecent(limit = 20): readonly HistoryProgress[] {
    return this.db
      .query<HistoryProgressRow, [number]>(
        "SELECT * FROM history_progress ORDER BY updated_at DESC LIMIT ?",
      )
      .all(limit)
      .map(mapHistoryRow);
  }

  listByTitle(titleId: string, limit = 500): readonly HistoryProgress[] {
    return this.db
      .query<HistoryProgressRow, [string, number]>(
        `
          SELECT * FROM history_progress
          WHERE title_id = ?
          ORDER BY
            COALESCE(season, 0) ASC,
            COALESCE(episode, 0) ASC,
            updated_at DESC
          LIMIT ?
        `,
      )
      .all(titleId, limit)
      .map(mapHistoryRow);
  }

  deleteTitle(titleId: string): void {
    this.db.query("DELETE FROM history_progress WHERE title_id = ?").run(titleId);
  }

  clear(): void {
    this.db.query("DELETE FROM history_progress").run();
  }
}

export function createHistoryKey(
  title: Pick<TitleIdentity, "id" | "kind">,
  episode?: EpisodeIdentity,
): string {
  return [
    title.kind,
    title.id,
    episode?.season ?? "none",
    episode?.episode ?? "none",
    episode?.absoluteEpisode ?? "none",
  ].join(":");
}

function mapHistoryRow(row: HistoryProgressRow): HistoryProgress {
  return {
    key: row.key,
    titleId: row.title_id,
    mediaKind: row.media_kind,
    title: row.title,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    absoluteEpisode: row.absolute_episode ?? undefined,
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds ?? undefined,
    completed: row.completed === 1,
    providerId: row.provider_id === null ? undefined : (row.provider_id as ProviderId),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}
