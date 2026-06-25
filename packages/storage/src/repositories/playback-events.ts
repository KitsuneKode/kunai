import { randomUUID } from "node:crypto";

import type { MediaKind, ProviderId } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

export type PlaybackEventType = "start" | "progress" | "pause" | "resume" | "seek" | "complete";

export interface PlaybackEventInput {
  readonly eventType: PlaybackEventType;
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly season?: number;
  readonly episode?: number;
  readonly positionSeconds?: number;
  readonly durationSeconds?: number;
  readonly providerId?: ProviderId;
  readonly at?: string;
  readonly payload?: Record<string, unknown>;
}

export interface PlaybackEventRecord {
  readonly id: string;
  readonly eventType: PlaybackEventType;
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly season?: number;
  readonly episode?: number;
  readonly positionSeconds?: number;
  readonly durationSeconds?: number;
  readonly providerId?: ProviderId;
  readonly at: string;
  readonly payload?: Record<string, unknown>;
}

interface PlaybackEventRow {
  readonly id: string;
  readonly event_type: PlaybackEventType;
  readonly title_id: string;
  readonly media_kind: MediaKind;
  readonly season: number | null;
  readonly episode: number | null;
  readonly position_seconds: number | null;
  readonly duration_seconds: number | null;
  readonly provider_id: string | null;
  readonly at: string;
  readonly payload_json: string | null;
}

export class PlaybackEventRepository {
  constructor(private readonly db: KunaiDatabase) {}

  insert(input: PlaybackEventInput): void {
    const at = input.at ?? new Date().toISOString();
    this.db
      .query(
        `
          INSERT INTO playback_events (
            id, event_type, title_id, media_kind, season, episode,
            position_seconds, duration_seconds, provider_id, at, payload_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        randomUUID(),
        input.eventType,
        input.titleId,
        input.mediaKind,
        input.season ?? null,
        input.episode ?? null,
        input.positionSeconds ?? null,
        input.durationSeconds ?? null,
        input.providerId ?? null,
        at,
        input.payload && Object.keys(input.payload).length > 0
          ? JSON.stringify(input.payload)
          : null,
      );
  }

  listByTitle(titleId: string, limit = 500): readonly PlaybackEventRecord[] {
    return this.db
      .query<PlaybackEventRow, [string, number]>(
        `
          SELECT * FROM playback_events
          WHERE title_id = ?
          ORDER BY at DESC
          LIMIT ?
        `,
      )
      .all(titleId, limit)
      .map(mapPlaybackEventRow);
  }

  listSince(sinceIso: string, limit = 5000): readonly PlaybackEventRecord[] {
    return this.db
      .query<PlaybackEventRow, [string, number]>(
        `
          SELECT * FROM playback_events
          WHERE at >= ?
          ORDER BY at ASC
          LIMIT ?
        `,
      )
      .all(sinceIso, limit)
      .map(mapPlaybackEventRow);
  }
}

function mapPlaybackEventRow(row: PlaybackEventRow): PlaybackEventRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    titleId: row.title_id,
    mediaKind: row.media_kind,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    positionSeconds: row.position_seconds ?? undefined,
    durationSeconds: row.duration_seconds ?? undefined,
    providerId: row.provider_id === null ? undefined : (row.provider_id as ProviderId),
    at: row.at,
    payload: parsePayload(row.payload_json),
  };
}

function parsePayload(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
