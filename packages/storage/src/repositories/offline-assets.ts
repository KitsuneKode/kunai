import { randomUUID } from "node:crypto";

import type { MediaKind } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

export type OfflineAssetState = "ready" | "missing" | "invalid-file" | "repairable";
export type OfflineAssetTrackKind = "subtitle" | "audio" | "timing";
export type OfflineAssetSidecarState = "ready" | "missing" | "repairable";

export interface OfflineAssetRecord {
  readonly id: string;
  readonly identityKey: string;
  readonly titleId: string;
  readonly titleName: string;
  readonly mediaKind: MediaKind;
  readonly season?: number;
  readonly episode?: number;
  readonly profileKey: string;
  readonly originJobId?: string;
  readonly filePath: string;
  readonly state: OfflineAssetState;
  readonly byteSize?: number;
  readonly durationMs?: number;
  readonly timingJson?: string;
  readonly lastValidatedAt?: string;
  readonly protected: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OfflineAssetInput {
  readonly titleId: string;
  readonly titleName: string;
  readonly mediaKind: MediaKind;
  readonly season?: number;
  readonly episode?: number;
  readonly profileKey: string;
  readonly originJobId?: string;
  readonly filePath: string;
  readonly state: OfflineAssetState;
  readonly byteSize?: number;
  readonly durationMs?: number;
  readonly timingJson?: string;
  readonly lastValidatedAt?: string;
  readonly protected?: boolean;
  readonly updatedAt: string;
}

export interface OfflineAssetTrackRecord {
  readonly assetId: string;
  readonly kind: OfflineAssetTrackKind;
  readonly language: string;
  readonly filePath: string;
  readonly state: OfflineAssetSidecarState;
  readonly updatedAt: string;
}

export interface OfflineAssetArtworkRecord {
  readonly assetId: string;
  readonly kind: "thumbnail" | "poster";
  readonly filePath: string;
  readonly state: OfflineAssetSidecarState;
  readonly updatedAt: string;
}

interface OfflineAssetRow {
  id: string;
  identity_key: string;
  title_id: string;
  title_name: string;
  media_kind: MediaKind;
  season: number | null;
  episode: number | null;
  profile_key: string;
  origin_job_id: string | null;
  file_path: string;
  state: OfflineAssetState;
  byte_size: number | null;
  duration_ms: number | null;
  timing_json: string | null;
  last_validated_at: string | null;
  protected: number;
  created_at: string;
  updated_at: string;
}

export class OfflineAssetsRepository {
  constructor(private readonly db: KunaiDatabase) {}

  upsertPlayable(input: OfflineAssetInput): OfflineAssetRecord {
    const identityKey = createOfflineAssetIdentityKey(input);
    const existing = this.getByIdentityKey(identityKey);
    const id = existing?.id ?? randomUUID();
    const createdAt = existing?.createdAt ?? input.updatedAt;
    const protectedValue = input.protected ?? existing?.protected ?? false;
    this.db
      .query(
        `INSERT INTO offline_assets (
           id, identity_key, title_id, title_name, media_kind, season, episode, profile_key,
           origin_job_id, file_path, state, byte_size, duration_ms, timing_json,
           last_validated_at, protected, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(identity_key) DO UPDATE SET
           title_name = excluded.title_name,
           origin_job_id = excluded.origin_job_id,
           file_path = excluded.file_path,
           state = excluded.state,
           byte_size = excluded.byte_size,
           duration_ms = excluded.duration_ms,
           timing_json = excluded.timing_json,
           last_validated_at = excluded.last_validated_at,
           protected = excluded.protected,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        identityKey,
        input.titleId,
        input.titleName,
        input.mediaKind,
        input.season ?? null,
        input.episode ?? null,
        input.profileKey,
        input.originJobId ?? null,
        input.filePath,
        input.state,
        input.byteSize ?? null,
        input.durationMs ?? null,
        input.timingJson ?? null,
        input.lastValidatedAt ?? null,
        protectedValue ? 1 : 0,
        createdAt,
        input.updatedAt,
      );
    const asset = this.getByIdentityKey(identityKey);
    if (!asset) throw new Error(`Offline asset not found after upsert: ${identityKey}`);
    return asset;
  }

  get(id: string): OfflineAssetRecord | undefined {
    const row = this.db
      .query<OfflineAssetRow, [string]>("SELECT * FROM offline_assets WHERE id = ?")
      .get(id);
    return row ? mapAssetRow(row) : undefined;
  }

  getByIdentityKey(identityKey: string): OfflineAssetRecord | undefined {
    const row = this.db
      .query<OfflineAssetRow, [string]>("SELECT * FROM offline_assets WHERE identity_key = ?")
      .get(identityKey);
    return row ? mapAssetRow(row) : undefined;
  }

  listTitleAssets(titleId: string, limit = 100): readonly OfflineAssetRecord[] {
    return this.db
      .query<OfflineAssetRow, [string, number]>(
        "SELECT * FROM offline_assets WHERE title_id = ? ORDER BY season ASC, episode ASC, updated_at DESC LIMIT ?",
      )
      .all(titleId, limit)
      .map(mapAssetRow);
  }

  listByTitleIds(titleIds: readonly string[]): readonly OfflineAssetRecord[] {
    const ids = [...new Set(titleIds)].filter(Boolean);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    return this.db
      .query<OfflineAssetRow, string[]>(
        `SELECT * FROM offline_assets WHERE title_id IN (${placeholders}) ORDER BY updated_at DESC`,
      )
      .all(...ids)
      .map(mapAssetRow);
  }

  markValidation(id: string, state: OfflineAssetState, validatedAt: string): void {
    this.db
      .query(
        "UPDATE offline_assets SET state = ?, last_validated_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(state, validatedAt, validatedAt, id);
  }

  setProtected(id: string, protectedValue: boolean, updatedAt: string): void {
    this.db
      .query("UPDATE offline_assets SET protected = ?, updated_at = ? WHERE id = ?")
      .run(protectedValue ? 1 : 0, updatedAt, id);
  }

  upsertTrack(input: OfflineAssetTrackRecord): void {
    this.db
      .query(
        `INSERT INTO offline_asset_tracks (asset_id, kind, language, file_path, state, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id, kind, language) DO UPDATE SET
           file_path = excluded.file_path,
           state = excluded.state,
           updated_at = excluded.updated_at`,
      )
      .run(input.assetId, input.kind, input.language, input.filePath, input.state, input.updatedAt);
  }

  upsertArtwork(input: OfflineAssetArtworkRecord): void {
    this.db
      .query(
        `INSERT INTO offline_asset_artwork (asset_id, kind, file_path, state, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(asset_id, kind) DO UPDATE SET
           file_path = excluded.file_path,
           state = excluded.state,
           updated_at = excluded.updated_at`,
      )
      .run(input.assetId, input.kind, input.filePath, input.state, input.updatedAt);
  }
}

export function createOfflineAssetIdentityKey(
  input: Pick<OfflineAssetInput, "titleId" | "mediaKind" | "season" | "episode" | "profileKey">,
): string {
  return [
    input.titleId,
    input.mediaKind,
    input.season ?? "movie",
    input.episode ?? "movie",
    input.profileKey,
  ].join(":");
}

function mapAssetRow(row: OfflineAssetRow): OfflineAssetRecord {
  return {
    id: row.id,
    identityKey: row.identity_key,
    titleId: row.title_id,
    titleName: row.title_name,
    mediaKind: row.media_kind,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    profileKey: row.profile_key,
    originJobId: row.origin_job_id ?? undefined,
    filePath: row.file_path,
    state: row.state,
    byteSize: row.byte_size ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    timingJson: row.timing_json ?? undefined,
    lastValidatedAt: row.last_validated_at ?? undefined,
    protected: row.protected === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
