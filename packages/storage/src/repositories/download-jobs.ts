import type { MediaKind, ProviderId } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

export type DownloadJobStatus = "queued" | "running" | "completed" | "failed" | "aborted";
export type DownloadArtifactStatus = "pending" | "ready" | "missing" | "invalid-file";

export interface DownloadJobRecord {
  readonly id: string;
  readonly titleId: string;
  readonly titleName: string;
  readonly mediaKind: MediaKind;
  readonly season?: number;
  readonly episode?: number;
  readonly providerId: ProviderId;
  readonly mode?: "series" | "anime";
  readonly subLang?: string;
  readonly animeLang?: "sub" | "dub";
  readonly selectedSourceId?: string;
  readonly selectedStreamId?: string;
  readonly selectedQualityLabel?: string;
  readonly streamUrl: string;
  readonly headers: Record<string, string>;
  readonly status: DownloadJobStatus;
  readonly progressPercent: number;
  readonly outputPath: string;
  readonly tempPath: string;
  readonly subtitleUrl?: string;
  readonly subtitlePath?: string;
  readonly subtitleLanguage?: string;
  readonly introSkipJson?: string;
  readonly durationMs?: number;
  readonly fileSize?: number;
  readonly errorMessage?: string;
  readonly retryCount: number;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly nextRetryAt?: string;
  readonly startedAt?: string;
  readonly lastHeartbeatAt?: string;
  readonly failureKind?: string;
  readonly artifactStatus?: DownloadArtifactStatus;
  readonly lastResolvedProviderId?: ProviderId;
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
  readonly mode: "series" | "anime" | null;
  readonly sub_lang: string | null;
  readonly anime_lang: "sub" | "dub" | null;
  readonly selected_source_id: string | null;
  readonly selected_stream_id: string | null;
  readonly selected_quality_label: string | null;
  readonly stream_url: string;
  readonly headers_json: string;
  readonly status: DownloadJobStatus;
  readonly progress_percent: number;
  readonly output_path: string;
  readonly temp_path: string;
  readonly subtitle_url: string | null;
  readonly subtitle_path: string | null;
  readonly subtitle_language: string | null;
  readonly intro_skip_json: string | null;
  readonly duration_ms: number | null;
  readonly file_size: number | null;
  readonly error_message: string | null;
  readonly retry_count: number;
  readonly attempt: number;
  readonly max_attempts: number;
  readonly next_retry_at: string | null;
  readonly started_at: string | null;
  readonly last_heartbeat_at: string | null;
  readonly failure_kind: string | null;
  readonly artifact_status: DownloadArtifactStatus;
  readonly last_resolved_provider_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

export class DownloadJobsRepository {
  constructor(private readonly db: KunaiDatabase) {}

  enqueue(
    input: Omit<
      DownloadJobRecord,
      | "status"
      | "progressPercent"
      | "retryCount"
      | "attempt"
      | "maxAttempts"
      | "nextRetryAt"
      | "startedAt"
      | "lastHeartbeatAt"
      | "failureKind"
      | "subtitleUrl"
      | "subtitlePath"
      | "subtitleLanguage"
      | "introSkipJson"
      | "durationMs"
      | "fileSize"
      | "artifactStatus"
      | "lastResolvedProviderId"
    >,
  ): void {
    this.db
      .query(
        `
          INSERT INTO download_jobs (
            id, title_id, title_name, media_kind, season, episode, provider_id,
            mode, sub_lang, anime_lang, selected_source_id, selected_stream_id, selected_quality_label,
            stream_url, headers_json,
            status, progress_percent, output_path, temp_path, subtitle_url, subtitle_path, subtitle_language,
            intro_skip_json, duration_ms, file_size, error_message, retry_count, attempt, max_attempts, next_retry_at,
            started_at, last_heartbeat_at, failure_kind, artifact_status, last_resolved_provider_id,
            created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 3, NULL, NULL, NULL, NULL, 'pending', NULL, ?, ?, NULL)
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
        input.mode ?? null,
        input.subLang ?? null,
        input.animeLang ?? null,
        input.selectedSourceId ?? null,
        input.selectedStreamId ?? null,
        input.selectedQualityLabel ?? null,
        input.streamUrl,
        JSON.stringify(input.headers),
        input.outputPath,
        input.tempPath,
        input.createdAt,
        input.updatedAt,
      );
  }

  updateOfflineMetadata(
    id: string,
    input: {
      subtitleUrl?: string | null;
      subtitlePath?: string | null;
      subtitleLanguage?: string | null;
      introSkipJson?: string | null;
      durationMs?: number | null;
    },
    updatedAt: string,
  ): void {
    this.db
      .query(
        `
          UPDATE download_jobs
          SET subtitle_url = COALESCE(?, subtitle_url),
              subtitle_path = COALESCE(?, subtitle_path),
              subtitle_language = COALESCE(?, subtitle_language),
              intro_skip_json = COALESCE(?, intro_skip_json),
              duration_ms = COALESCE(?, duration_ms),
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        input.subtitleUrl ?? null,
        input.subtitlePath ?? null,
        input.subtitleLanguage ?? null,
        input.introSkipJson ?? null,
        input.durationMs ?? null,
        updatedAt,
        id,
      );
  }

  updateFileSize(id: string, fileSize: number, updatedAt: string): void {
    this.db
      .query("UPDATE download_jobs SET file_size = ?, updated_at = ? WHERE id = ?")
      .run(fileSize, updatedAt, id);
  }

  updateResolvedStream(
    id: string,
    input: {
      streamUrl: string;
      headers: Record<string, string>;
      providerId?: ProviderId;
    },
    updatedAt: string,
  ): void {
    this.db
      .query(
        `
          UPDATE download_jobs
          SET stream_url = ?,
              headers_json = ?,
              last_resolved_provider_id = COALESCE(?, last_resolved_provider_id),
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(input.streamUrl, JSON.stringify(input.headers), input.providerId ?? null, updatedAt, id);
  }

  markRunning(id: string, updatedAt: string): void {
    this.db
      .query(
        `
          UPDATE download_jobs
          SET status = 'running',
              attempt = attempt + 1,
              started_at = COALESCE(started_at, ?),
              last_heartbeat_at = ?,
              next_retry_at = NULL,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(updatedAt, updatedAt, updatedAt, id);
  }

  markHeartbeat(id: string, updatedAt: string): void {
    this.db
      .query("UPDATE download_jobs SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?")
      .run(updatedAt, updatedAt, id);
  }

  updateProgress(id: string, progressPercent: number, updatedAt: string): void {
    this.db
      .query(
        "UPDATE download_jobs SET progress_percent = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(Math.max(0, Math.min(100, Math.trunc(progressPercent))), updatedAt, updatedAt, id);
  }

  complete(id: string, updatedAt: string): void {
    this.db
      .query(
        `
          UPDATE download_jobs
          SET status = 'completed',
              progress_percent = 100,
              next_retry_at = NULL,
              failure_kind = NULL,
              artifact_status = 'ready',
              updated_at = ?,
              completed_at = ?
          WHERE id = ?
        `,
      )
      .run(updatedAt, updatedAt, id);
  }

  fail(
    id: string,
    message: string,
    incrementRetry: boolean,
    updatedAt: string,
    failureKind: string = "unknown",
  ): void {
    this.db
      .query(
        `
          UPDATE download_jobs
          SET status = 'failed',
              error_message = ?,
              failure_kind = ?,
              next_retry_at = NULL,
              artifact_status = CASE WHEN ? = 'artifact-invalid' THEN 'invalid-file' ELSE artifact_status END,
              retry_count = retry_count + ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(message, failureKind, failureKind, incrementRetry ? 1 : 0, updatedAt, id);
  }

  scheduleRetry(id: string, message: string, retryAt: string, updatedAt: string): void {
    this.db
      .query(
        `
          UPDATE download_jobs
          SET status = 'queued',
              error_message = ?,
              failure_kind = 'transient',
              retry_count = retry_count + 1,
              next_retry_at = ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(message, retryAt, updatedAt, id);
  }

  requeue(id: string, updatedAt: string): void {
    this.db
      .query(
        `
          UPDATE download_jobs
          SET status = 'queued',
              error_message = NULL,
              failure_kind = NULL,
              next_retry_at = NULL,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(updatedAt, id);
  }

  abort(id: string, updatedAt: string): void {
    this.db
      .query(
        `
          UPDATE download_jobs
          SET status = 'aborted',
              error_message = NULL,
              failure_kind = 'aborted',
              next_retry_at = NULL,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(updatedAt, id);
  }

  delete(id: string): void {
    this.db.query("DELETE FROM download_jobs WHERE id = ?").run(id);
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

  listRunning(limit = 100): readonly DownloadJobRecord[] {
    return this.db
      .query<DownloadJobRow, [number]>(
        "SELECT * FROM download_jobs WHERE status = 'running' ORDER BY created_at ASC LIMIT ?",
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

  listFailed(limit = 100): readonly DownloadJobRecord[] {
    return this.db
      .query<DownloadJobRow, [number]>(
        "SELECT * FROM download_jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT ?",
      )
      .all(limit)
      .map(mapRow);
  }

  listActive(limit = 100): readonly DownloadJobRecord[] {
    return this.db
      .query<DownloadJobRow, [number]>(
        `
          SELECT * FROM download_jobs
          WHERE status IN ('queued', 'running')
          ORDER BY created_at ASC
          LIMIT ?
        `,
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
    mode: row.mode ?? undefined,
    subLang: row.sub_lang ?? undefined,
    animeLang: row.anime_lang ?? undefined,
    selectedSourceId: row.selected_source_id ?? undefined,
    selectedStreamId: row.selected_stream_id ?? undefined,
    selectedQualityLabel: row.selected_quality_label ?? undefined,
    streamUrl: row.stream_url,
    headers: parseHeaders(row.headers_json),
    status: row.status,
    progressPercent: row.progress_percent,
    outputPath: row.output_path,
    tempPath: row.temp_path,
    subtitleUrl: row.subtitle_url ?? undefined,
    subtitlePath: row.subtitle_path ?? undefined,
    subtitleLanguage: row.subtitle_language ?? undefined,
    introSkipJson: row.intro_skip_json ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    fileSize: row.file_size ?? undefined,
    errorMessage: row.error_message ?? undefined,
    retryCount: row.retry_count,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    nextRetryAt: row.next_retry_at ?? undefined,
    startedAt: row.started_at ?? undefined,
    lastHeartbeatAt: row.last_heartbeat_at ?? undefined,
    failureKind: row.failure_kind ?? undefined,
    artifactStatus: row.artifact_status ?? "pending",
    lastResolvedProviderId: (row.last_resolved_provider_id as ProviderId | null) ?? undefined,
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
