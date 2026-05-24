import type { MediaKind } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

export interface OfflineTitlePolicyRecord {
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly titleName: string;
  readonly enrolled: boolean;
  readonly runwayTarget: number;
  readonly profileJson: string;
  readonly cleanupJson: string;
  readonly pausedReason?: string;
  readonly updatedAt: string;
}

interface OfflineTitlePolicyRow {
  title_id: string;
  media_kind: MediaKind;
  title_name: string;
  enrolled: number;
  runway_target: number;
  profile_json: string;
  cleanup_json: string;
  paused_reason: string | null;
  updated_at: string;
}

export class OfflineTitlePoliciesRepository {
  constructor(private readonly db: KunaiDatabase) {}

  upsert(input: OfflineTitlePolicyRecord): OfflineTitlePolicyRecord {
    this.db
      .query(
        `INSERT INTO offline_title_policies (
           title_id, media_kind, title_name, enrolled, runway_target, profile_json,
           cleanup_json, paused_reason, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(title_id) DO UPDATE SET
           media_kind = excluded.media_kind,
           title_name = excluded.title_name,
           enrolled = excluded.enrolled,
           runway_target = excluded.runway_target,
           profile_json = excluded.profile_json,
           cleanup_json = excluded.cleanup_json,
           paused_reason = excluded.paused_reason,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.titleId,
        input.mediaKind,
        input.titleName,
        input.enrolled ? 1 : 0,
        Math.max(0, Math.trunc(input.runwayTarget)),
        input.profileJson,
        input.cleanupJson,
        input.pausedReason ?? null,
        input.updatedAt,
      );
    const record = this.get(input.titleId);
    if (!record) throw new Error(`Offline title policy not found after upsert: ${input.titleId}`);
    return record;
  }

  get(titleId: string): OfflineTitlePolicyRecord | undefined {
    const row = this.db
      .query<OfflineTitlePolicyRow, [string]>(
        "SELECT * FROM offline_title_policies WHERE title_id = ?",
      )
      .get(titleId);
    return row ? mapPolicyRow(row) : undefined;
  }

  listEnrolled(limit = 100): readonly OfflineTitlePolicyRecord[] {
    return this.db
      .query<OfflineTitlePolicyRow, [number]>(
        "SELECT * FROM offline_title_policies WHERE enrolled = 1 ORDER BY updated_at DESC LIMIT ?",
      )
      .all(limit)
      .map(mapPolicyRow);
  }
}

function mapPolicyRow(row: OfflineTitlePolicyRow): OfflineTitlePolicyRecord {
  return {
    titleId: row.title_id,
    mediaKind: row.media_kind,
    titleName: row.title_name,
    enrolled: row.enrolled === 1,
    runwayTarget: row.runway_target,
    profileJson: row.profile_json,
    cleanupJson: row.cleanup_json,
    pausedReason: row.paused_reason ?? undefined,
    updatedAt: row.updated_at,
  };
}
