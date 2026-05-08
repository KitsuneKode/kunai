import type { MediaKind, ProviderId } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

export type DownloadJobStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export interface DownloadJobRecord {
  readonly id: string;
  readonly titleId: string;
  readonly titleName: string;
  readonly mediaKind: MediaKind;
  readonly season?: number;
  readonly episode?: number;
  readonly providerId: ProviderId;
  readonly streamUrl: string;
  readonly headers: Record<string, string>;
  readonly status: DownloadJobStatus;
  readonly progressPercent: number;
  readonly outputPath: string;
  readonly tempPath: string;
  readonly errorMessage?: string;
  readonly retryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

interface DownloadJobRow {
  readonly id: string;
  readonly title_id: string;
  readonly title_name: string;
  readonly media_kind: MediaKind;
  readonly season: number | null;
  readonly episode: number | null;
  readonly provider_id: string;
  readonly stream_url: string;
  readonly headers_json: string;
  readonly status: DownloadJobStatus;
  readonly progress_percent: number;
  readonly output_path: string;
  readonly temp_path: string;
  readonly error_message: string | null;
  readonly retry_count: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

export class DownloadJobsRepository {
  constructor(private readonly db: KunaiDatabase) {}

  enqueue(input: Omit<DownloadJobRecord, "status" | "progressPercent" | "retryCount">): void {
    this.db
      .query(
        `
          INSERT INTO download_jobs (
            id, title_id, title_name, media_kind, season, episode, provider_id, stream_url, headers_json,
            status, progress_percent, output_path, temp_path, error_message, retry_count, created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, NULL, 0, ?, ?, NULL)
        `,
      )
      .run(
        input.id,
        input.titleId,
        input.titleName,
        input.mediaKind,
        input.season ?? null,
        input.episode ?? null,
        input.providerId,
        input.streamUrl,
        JSON.stringify(input.headers),
        input.outputPath,
        input.tempPath,
        input.createdAt,
        input.updatedAt,
      );
  }

  markRunning(id: string, updatedAt: string): void {
    this.db
      .query("UPDATE download_jobs SET status = 'running', updated_at = ? WHERE id = ?")
      .run(updatedAt, id);
  }

  updateProgress(id: string, progressPercent: number, updatedAt: string): void {
    this.db
      .query("UPDATE download_jobs SET progress_percent = ?, updated_at = ? WHERE id = ?")
      .run(Math.max(0, Math.min(100, Math.trunc(progressPercent))), updatedAt, id);
  }

  complete(id: string, updatedAt: string): void {
    this.db
      .query(
        "UPDATE download_jobs SET status = 'completed', progress_percent = 100, updated_at = ?, completed_at = ? WHERE id = ?",
      )
      .run(updatedAt, updatedAt, id);
  }

  fail(id: string, message: string, incrementRetry: boolean, updatedAt: string): void {
    this.db
      .query(
        `
          UPDATE download_jobs
          SET status = 'failed',
              error_message = ?,
              retry_count = retry_count + ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(message, incrementRetry ? 1 : 0, updatedAt, id);
  }

  abort(id: string, updatedAt: string): void {
    this.db
      .query(
        "UPDATE download_jobs SET status = 'aborted', error_message = NULL, updated_at = ? WHERE id = ?",
      )
      .run(updatedAt, id);
  }

  get(id: string): DownloadJobRecord | undefined {
    const row = this.db
      .query<DownloadJobRow, [string]>("SELECT * FROM download_jobs WHERE id = ?")
      .get(id);
    return row === null ? undefined : mapRow(row);
  }

  listQueued(limit = 20): readonly DownloadJobRecord[] {
    return this.db
      .query<DownloadJobRow, [number]>(
        "SELECT * FROM download_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?",
      )
      .all(limit)
      .map(mapRow);
  }

  listByTitle(titleId: string, limit = 100): readonly DownloadJobRecord[] {
    return this.db
      .query<DownloadJobRow, [string, number]>(
        "SELECT * FROM download_jobs WHERE title_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(titleId, limit)
      .map(mapRow);
  }

  listCompleted(limit = 100): readonly DownloadJobRecord[] {
    return this.db
      .query<DownloadJobRow, [number]>(
        "SELECT * FROM download_jobs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT ?",
      )
      .all(limit)
      .map(mapRow);
  }
}

function mapRow(row: DownloadJobRow): DownloadJobRecord {
  return {
    id: row.id,
    titleId: row.title_id,
    titleName: row.title_name,
    mediaKind: row.media_kind,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    providerId: row.provider_id as ProviderId,
    streamUrl: row.stream_url,
    headers: parseHeaders(row.headers_json),
    status: row.status,
    progressPercent: row.progress_percent,
    outputPath: row.output_path,
    tempPath: row.temp_path,
    errorMessage: row.error_message ?? undefined,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function parseHeaders(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
