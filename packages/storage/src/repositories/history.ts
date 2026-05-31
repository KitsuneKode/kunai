import type {
  EpisodeIdentity,
  MediaKind,
  ProviderExternalIds,
  ProviderId,
  TitleIdentity,
} from "@kunai/types";

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
  readonly externalIds?: ProviderExternalIds;
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
  readonly external_ids_json: string | null;
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
            external_ids_json,
            updated_at,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            title = excluded.title,
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            completed = excluded.completed,
            provider_id = excluded.provider_id,
            external_ids_json = excluded.external_ids_json,
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
        serializeExternalIds(input.title.externalIds),
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

/**
 * Project a fully-materialized {@link HistoryProgress} row back into the
 * {@link HistoryProgressInput} shape accepted by {@link HistoryRepository.upsertProgress}.
 * Use when a caller holds a canonical row (e.g. just edited one in memory) and
 * needs to persist it without re-deriving each field by hand.
 */
export function historyProgressToInput(progress: HistoryProgress): HistoryProgressInput {
  return {
    title: {
      id: progress.titleId,
      kind: progress.mediaKind,
      title: progress.title,
      externalIds: progress.externalIds,
    },
    episode: {
      season: progress.season,
      episode: progress.episode,
      absoluteEpisode: progress.absoluteEpisode,
    },
    positionSeconds: progress.positionSeconds,
    durationSeconds: progress.durationSeconds,
    completed: progress.completed,
    providerId: progress.providerId,
    updatedAt: progress.updatedAt,
  };
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
    externalIds: parseExternalIds(row.external_ids_json),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function serializeExternalIds(externalIds: ProviderExternalIds | undefined): string | null {
  if (!externalIds || Object.keys(externalIds).length === 0) return null;
  return JSON.stringify(externalIds);
}

function parseExternalIds(value: string | null): ProviderExternalIds | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ProviderExternalIds>;
    const externalIds: ProviderExternalIds = {
      ...(typeof parsed.anilistId === "string" && parsed.anilistId
        ? { anilistId: parsed.anilistId }
        : {}),
      ...(typeof parsed.tmdbId === "string" && parsed.tmdbId ? { tmdbId: parsed.tmdbId } : {}),
      ...(typeof parsed.imdbId === "string" && parsed.imdbId ? { imdbId: parsed.imdbId } : {}),
      ...(typeof parsed.malId === "string" && parsed.malId ? { malId: parsed.malId } : {}),
    };
    return Object.keys(externalIds).length > 0 ? externalIds : undefined;
  } catch {
    return undefined;
  }
}
