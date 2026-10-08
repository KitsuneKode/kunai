import { SQLiteError } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { win32 } from "node:path";

import type {
  MediaKind,
  ProviderEpisodeIdentity,
  ProviderExternalIds,
  ProviderId,
} from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

export type DownloadJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed-with-notes"
  | "repairable"
  | "failed"
  | "aborted";
export type DownloadArtifactStatus =
  | "pending"
  | "ready"
  | "missing"
  | "invalid-file"
  | "optional-missing"
  | "expected-missing"
  | "failed"
  | "not-applicable";

export interface DownloadJobRecord {
  readonly id: string;
  readonly titleId: string;
  /**
   * The external ids the title carried when the download was enqueued.
   *
   * Without them the service had to guess them back out of `titleId`, which
   * turned a MAL-only anime into `{ anilistId: <malId> }` — a wrong id asserted
   * confidently and re-consumed on every re-resolve.
   */
  readonly externalIds?: ProviderExternalIds;
  readonly titleName: string;
  readonly mediaKind: MediaKind;
  /** Product structure; independent from identity (for example, an anime film). */
  readonly contentType?: "movie" | "series";
  readonly season?: number;
  readonly episode?: number;
  readonly providerEpisodeIdentity?: ProviderEpisodeIdentity;
  readonly providerId: ProviderId;
  readonly mode?: "series" | "anime" | "youtube";
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
  readonly posterUrl?: string;
  readonly thumbnailPath?: string;
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
  readonly repairMetadataJson?: string;
  readonly lastResolvedProviderId?: ProviderId;
  readonly lastValidatedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly ownerToken?: string;
  readonly claimGeneration?: number;
  readonly stagingDir?: string;
  readonly publicationPending?: boolean;
  readonly publicationDevice?: string;
  readonly publicationInode?: string;
}

export interface DownloadClaimRef {
  readonly jobId: string;
  readonly ownerToken: string;
  readonly generation: number;
  readonly stagingDir: string;
}

interface DownloadJobRow {
  readonly id: string;
  readonly title_id: string;
  readonly external_ids_json: string | null;
  readonly title_name: string;
  readonly media_kind: MediaKind;
  readonly content_type: "movie" | "series" | null;
  readonly season: number | null;
  readonly episode: number | null;
  readonly provider_episode_provider_id: string | null;
  readonly provider_episode_value: string | null;
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
  readonly poster_url: string | null;
  readonly thumbnail_path: string | null;
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
  readonly repair_metadata_json: string | null;
  readonly last_resolved_provider_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly last_validated_at: string | null;
  readonly owner_token: string | null;
  readonly claim_generation: number;
  readonly staging_dir: string | null;
  readonly publication_pending: number;
  readonly publication_dev: string | null;
  readonly publication_ino: string | null;
}

export class DownloadJobAdmissionConflictError extends Error {
  readonly code = "duplicate-intent";

  constructor() {
    super("A blocking download intent already exists");
    this.name = "DownloadJobAdmissionConflictError";
  }
}

const DOWNLOAD_INTENT_UNIQUE_INDEX = "idx_download_jobs_blocking_intent";

export class DownloadJobsRepository {
  /** A legacy shared destination is ambiguous even when the other job failed. */
  hasConflictingOutputOwner(jobId: string, outputPath: string): boolean {
    if (this.platform === "win32") {
      // Compare only at the ownership boundary: keep recorded paths intact.
      // SQLite NOCASE is ASCII-only; filenames can include Unicode letters.
      const identity = win32.normalize(outputPath).toUpperCase();
      return this.db
        .query<{ path: string }, [string, string]>(
          `SELECT output_path AS path FROM download_jobs WHERE id <> ?
         UNION ALL
         SELECT file_path AS path FROM offline_assets WHERE origin_job_id IS NULL OR origin_job_id <> ?`,
        )
        .all(jobId, jobId)
        .some(({ path }) => win32.normalize(path).toUpperCase() === identity);
    }
    return (
      this.db
        .query<{ conflict: number }, [string, string, string, string]>(
          `SELECT EXISTS (
        SELECT 1 FROM download_jobs WHERE output_path = ? AND id <> ?
        UNION ALL
        SELECT 1 FROM offline_assets WHERE file_path = ? AND (origin_job_id IS NULL OR origin_job_id <> ?)
      ) AS conflict`,
        )
        .get(outputPath, jobId, outputPath, jobId)?.conflict === 1
    );
  }
  constructor(
    private readonly db: KunaiDatabase,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

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
      | "thumbnailPath"
      | "durationMs"
      | "fileSize"
      | "artifactStatus"
      | "lastResolvedProviderId"
      | "ownerToken"
      | "claimGeneration"
      | "stagingDir"
      | "publicationPending"
      | "publicationDevice"
      | "publicationInode"
    >,
  ): void {
    try {
      this.db
        .query(
          `
          INSERT INTO download_jobs (
            id, title_id, external_ids_json, title_name, media_kind, content_type, season, episode,
            provider_episode_provider_id, provider_episode_value, provider_id,
            mode, sub_lang, anime_lang, selected_source_id, selected_stream_id, selected_quality_label,
            stream_url, headers_json,
            status, progress_percent, output_path, temp_path, subtitle_url, subtitle_path, subtitle_language,
            intro_skip_json, poster_url, thumbnail_path, duration_ms, file_size, error_message, retry_count, attempt, max_attempts, next_retry_at,
            started_at, last_heartbeat_at, failure_kind, artifact_status, last_resolved_provider_id,
            created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, NULL, NULL, 0, 0, 3, NULL, NULL, NULL, NULL, 'pending', NULL, ?, ?, NULL)
        `,
        )
        .run(
          input.id,
          input.titleId,
          input.externalIds ? JSON.stringify(input.externalIds) : null,
          input.titleName,
          input.mediaKind,
          input.contentType ?? null,
          input.season ?? null,
          input.episode ?? null,
          input.providerEpisodeIdentity?.providerId ?? null,
          input.providerEpisodeIdentity?.value ?? null,
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
          input.posterUrl ?? null,
          input.createdAt,
          input.updatedAt,
        );
    } catch (error) {
      if (
        error instanceof SQLiteError &&
        error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
        error.message.includes(`index '${DOWNLOAD_INTENT_UNIQUE_INDEX}'`)
      ) {
        throw new DownloadJobAdmissionConflictError();
      }
      throw error;
    }
  }

  updateOfflineMetadata(
    id: string,
    input: {
      subtitleUrl?: string | null;
      subtitlePath?: string | null;
      subtitleLanguage?: string | null;
      introSkipJson?: string | null;
      thumbnailPath?: string | null;
      durationMs?: number | null;
    },
    updatedAt: string,
    claim?: DownloadClaimRef,
  ): boolean {
    const assignments: string[] = [];
    const values: Array<string | number | null> = [];

    const setIfPresent = (key: keyof typeof input, column: string) => {
      if (!Object.hasOwn(input, key)) return;
      assignments.push(`${column} = ?`);
      values.push(input[key] ?? null);
    };

    setIfPresent("subtitleUrl", "subtitle_url");
    setIfPresent("subtitlePath", "subtitle_path");
    setIfPresent("subtitleLanguage", "subtitle_language");
    setIfPresent("introSkipJson", "intro_skip_json");
    setIfPresent("thumbnailPath", "thumbnail_path");
    setIfPresent("durationMs", "duration_ms");

    assignments.push("updated_at = ?");
    values.push(updatedAt);

    return (
      applyClaimedUpdate(
        this.db,
        `UPDATE download_jobs SET ${assignments.join(", ")} WHERE id = ?`,
        values,
        id,
        claim,
      ) > 0
    );
  }

  updateFileSize(
    id: string,
    fileSize: number,
    updatedAt: string,
    claim?: DownloadClaimRef,
  ): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        "UPDATE download_jobs SET file_size = ?, updated_at = ? WHERE id = ?",
        [fileSize, updatedAt],
        id,
        claim,
      ) > 0
    );
  }

  updateResolvedStream(
    id: string,
    input: {
      streamUrl: string;
      headers: Record<string, string>;
      providerId?: ProviderId;
    },
    updatedAt: string,
    claim?: DownloadClaimRef,
  ): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        `
          UPDATE download_jobs
          SET stream_url = ?,
              headers_json = ?,
              last_resolved_provider_id = COALESCE(?, last_resolved_provider_id),
              updated_at = ?
          WHERE id = ?
        `,
        [input.streamUrl, JSON.stringify(input.headers), input.providerId ?? null, updatedAt],
        id,
        claim,
      ) > 0
    );
  }

  /** Compare-and-set a queued job into running ownership. */
  markRunning(id: string, updatedAt: string): DownloadClaimRef | undefined {
    const claim = this.db.transaction((): DownloadClaimRef | undefined => {
      const row = this.db
        .query<ClaimSeedRow, [string]>(
          "SELECT claim_generation, temp_path, status FROM download_jobs WHERE id = ?",
        )
        .get(id);
      if (row === null || row.status !== "queued") return undefined;
      const generation = row.claim_generation + 1;
      const ownerToken = randomUUID();
      const stagingDir = `${row.temp_path}.claim-${generation}`;
      const result = this.db
        .query(
          `
            UPDATE download_jobs
            SET status = 'running',
                attempt = attempt + 1,
                started_at = COALESCE(started_at, ?),
                last_heartbeat_at = ?,
                next_retry_at = NULL,
                owner_token = ?,
                claim_generation = ?,
                staging_dir = ?,
                updated_at = ?
            WHERE id = ? AND status = 'queued' AND publication_pending = 0 AND claim_generation = ?
          `,
        )
        .run(
          updatedAt,
          updatedAt,
          ownerToken,
          generation,
          stagingDir,
          updatedAt,
          id,
          row.claim_generation,
        );
      if (result.changes === 0) return undefined;
      return { jobId: id, ownerToken, generation, stagingDir };
    });
    return claim.immediate();
  }

  /** Acquire an expired running lease using the heartbeat observed by the reader. */
  claimRunningForRecovery(
    id: string,
    observedHeartbeatAt: string | undefined,
    updatedAt: string,
    observedGeneration: number,
  ): DownloadClaimRef | undefined {
    const claim = this.db.transaction((): DownloadClaimRef | undefined => {
      const row = this.db
        .query<ClaimSeedRow, [string]>(
          "SELECT claim_generation, temp_path, staging_dir, status, last_heartbeat_at FROM download_jobs WHERE id = ?",
        )
        .get(id);
      if (row === null || row.status !== "running" || row.claim_generation !== observedGeneration)
        return undefined;
      if ((row.last_heartbeat_at ?? null) !== (observedHeartbeatAt ?? null)) return undefined;
      const generation = row.claim_generation + 1;
      const ownerToken = randomUUID();
      // Recovery performs no transfer. Retain the original attempt's path as
      // publication proof across failed recovery commits; markRunning assigns
      // a fresh namespace when a subsequent transfer actually starts.
      const stagingDir = row.staging_dir ?? `${row.temp_path}.claim-${generation}`;
      const result = this.db
        .query(
          `
            UPDATE download_jobs
            SET last_heartbeat_at = ?,
                updated_at = ?,
                owner_token = ?,
                claim_generation = ?
            WHERE id = ?
              AND status = 'running'
              AND last_heartbeat_at IS ?
              AND claim_generation = ?
          `,
        )
        .run(
          updatedAt,
          updatedAt,
          ownerToken,
          generation,
          id,
          observedHeartbeatAt ?? null,
          row.claim_generation,
        );
      if (result.changes === 0) return undefined;
      return { jobId: id, ownerToken, generation, stagingDir };
    });
    return claim.immediate();
  }

  /** Fence a synchronous effect and return its result; never await under the writer lock. */
  withRunningClaim<T>(
    claim: DownloadClaimRef,
    effect: () => T & (T extends PromiseLike<unknown> ? never : unknown),
  ): { readonly owned: true; readonly value: T } | { readonly owned: false } {
    return this.db
      .transaction((): { readonly owned: true; readonly value: T } | { readonly owned: false } => {
        const row = this.db
          .query<{ id: string }, [string, string, number]>(
            "SELECT id FROM download_jobs WHERE id = ? AND status = 'running' AND owner_token = ? AND claim_generation = ?",
          )
          .get(claim.jobId, claim.ownerToken, claim.generation);
        if (!row) return { owned: false };
        return { owned: true, value: effect() };
      })
      .immediate();
  }

  /** Persist a copy reservation before writing any bytes to its exclusive destination. */
  setPublication(
    id: string,
    identity: { device: string; inode: string; phase: "copying" | "published" } | null,
    updatedAt: string,
    claim: DownloadClaimRef,
  ): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        "UPDATE download_jobs SET publication_pending = ?, publication_dev = ?, publication_ino = ?, updated_at = ? WHERE id = ?",
        [
          identity?.phase === "copying" ? 1 : 0,
          identity?.device ?? null,
          identity?.inode ?? null,
          updatedAt,
        ],
        id,
        claim,
      ) > 0
    );
  }

  markHeartbeat(id: string, updatedAt: string, claim?: DownloadClaimRef): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        "UPDATE download_jobs SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?",
        [updatedAt, updatedAt],
        id,
        claim,
      ) > 0
    );
  }

  updateProgress(
    id: string,
    progressPercent: number,
    updatedAt: string,
    claim?: DownloadClaimRef,
  ): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        "UPDATE download_jobs SET progress_percent = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ?",
        [Math.max(0, Math.min(100, Math.trunc(progressPercent))), updatedAt, updatedAt],
        id,
        claim,
      ) > 0
    );
  }

  complete(id: string, updatedAt: string, claim?: DownloadClaimRef): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        `
          UPDATE download_jobs
          SET status = 'completed',
              progress_percent = 100,
              next_retry_at = NULL,
              failure_kind = NULL,
              artifact_status = 'ready',
              owner_token = NULL,
              updated_at = ?,
              completed_at = ?,
              last_validated_at = ?
          -- Completion is only reachable from a live run or the sidecar-repair
          -- path (repairable / completed-with-notes). Writing 'completed' over
          -- an aborted, failed, or still-queued row is a stale writer
          -- resurrecting work another instance cancelled.
          WHERE id = ? AND status IN ('running', 'repairable', 'completed-with-notes')
        `,
        [updatedAt, updatedAt, updatedAt],
        id,
        claim,
      ) > 0
    );
  }

  completeWithNotes(
    id: string,
    input: {
      artifactStatus: Extract<DownloadArtifactStatus, "optional-missing" | "not-applicable">;
      message: string;
      repairMetadataJson?: string | null;
    },
    updatedAt: string,
    claim?: DownloadClaimRef,
  ): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        `
          UPDATE download_jobs
          SET status = 'completed-with-notes',
              progress_percent = 100,
              next_retry_at = NULL,
              failure_kind = NULL,
              error_message = ?,
              artifact_status = ?,
              repair_metadata_json = ?,
              owner_token = NULL,
              updated_at = ?,
              completed_at = COALESCE(completed_at, ?),
              last_validated_at = ?
          -- Same fence as complete(), plus 'completed': the artwork-missing
          -- downgrade path moves completed → completed-with-notes.
          WHERE id = ?
            AND status IN ('running', 'repairable', 'completed-with-notes', 'completed')
        `,
        [
          input.message,
          input.artifactStatus,
          input.repairMetadataJson ?? null,
          updatedAt,
          updatedAt,
          updatedAt,
        ],
        id,
        claim,
      ) > 0
    );
  }

  markRepairable(
    id: string,
    input: {
      artifactStatus: Extract<DownloadArtifactStatus, "expected-missing" | "failed">;
      message: string;
      repairMetadataJson: string;
    },
    updatedAt: string,
    claim?: DownloadClaimRef,
  ): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        `
          UPDATE download_jobs
          SET status = 'repairable',
              progress_percent = 100,
              next_retry_at = NULL,
              failure_kind = 'sidecar-repairable',
              error_message = ?,
              artifact_status = ?,
              repair_metadata_json = ?,
              owner_token = NULL,
              updated_at = ?,
              completed_at = COALESCE(completed_at, ?),
              last_validated_at = ?
          -- Live run or a re-failed repair pass; never resurrect aborted,
          -- failed, or queued rows.
          WHERE id = ? AND status IN ('running', 'repairable', 'completed-with-notes')
        `,
        [
          input.message,
          input.artifactStatus,
          input.repairMetadataJson,
          updatedAt,
          updatedAt,
          updatedAt,
        ],
        id,
        claim,
      ) > 0
    );
  }

  markArtifactValidated(id: string, status: DownloadArtifactStatus, validatedAt: string): void {
    this.db
      .query(
        `
          UPDATE download_jobs
          SET artifact_status = ?,
              last_validated_at = ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(status, validatedAt, validatedAt, id);
  }

  fail(
    id: string,
    message: string,
    incrementRetry: boolean,
    updatedAt: string,
    failureKind: string = "unknown",
    claim?: DownloadClaimRef,
  ): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        `
          UPDATE download_jobs
          SET status = 'failed',
              error_message = ?,
              failure_kind = ?,
              next_retry_at = NULL,
              artifact_status = CASE WHEN ? = 'artifact-invalid' THEN 'invalid-file' ELSE artifact_status END,
              retry_count = retry_count + ?,
              owner_token = NULL,
              updated_at = ?
          -- 'completed' is final and 'aborted' is user intent: a stale failing
          -- writer must not resurrect either. 'repairable' and
          -- 'completed-with-notes' may still fail when the repair sweep finds
          -- the artifact file missing.
          WHERE id = ?
            AND status NOT IN ('completed', 'aborted')
        `,
        [message, failureKind, failureKind, incrementRetry ? 1 : 0, updatedAt],
        id,
        claim,
      ) > 0
    );
  }

  scheduleRetry(
    id: string,
    message: string,
    retryAt: string,
    updatedAt: string,
    claim?: DownloadClaimRef,
  ): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        `
          UPDATE download_jobs
          SET status = 'queued',
              error_message = ?,
              failure_kind = 'transient',
              retry_count = retry_count + 1,
              next_retry_at = ?,
              owner_token = NULL,
              updated_at = ?
          WHERE id = ?
            AND status NOT IN ('completed', 'completed-with-notes', 'repairable', 'aborted')
        `,
        [message, retryAt, updatedAt],
        id,
        claim,
      ) > 0
    );
  }

  deferQueued(id: string, message: string, retryAt: string, updatedAt: string): boolean {
    const result = this.db
      .query(
        `
          UPDATE download_jobs
          SET error_message = ?,
              failure_kind = 'interrupted',
              next_retry_at = ?,
              updated_at = ?
          WHERE id = ? AND status = 'queued'
        `,
      )
      .run(message, retryAt, updatedAt, id);
    return result.changes > 0;
  }

  pause(
    id: string,
    message: string,
    retryAt: string,
    updatedAt: string,
    claim?: DownloadClaimRef,
  ): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        `
          UPDATE download_jobs
          SET status = 'queued',
              error_message = ?,
              failure_kind = 'interrupted',
              next_retry_at = ?,
              owner_token = NULL,
              updated_at = ?
          WHERE id = ? AND status IN ('running', 'queued')
        `,
        [message, retryAt, updatedAt],
        id,
        claim,
      ) > 0
    );
  }

  requeue(id: string, updatedAt: string): boolean {
    try {
      const result = this.db
        .query(
          `
          UPDATE download_jobs
          SET status = 'queued',
              error_message = NULL,
              failure_kind = NULL,
              repair_metadata_json = NULL,
              next_retry_at = NULL,
              updated_at = ?
          WHERE id = ? AND status != 'running' AND publication_pending = 0
        `,
        )
        .run(updatedAt, id);
      return result.changes > 0;
    } catch (error) {
      if (
        error instanceof SQLiteError &&
        error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
        error.message.includes(`index '${DOWNLOAD_INTENT_UNIQUE_INDEX}'`)
      ) {
        throw new DownloadJobAdmissionConflictError();
      }
      throw error;
    }
  }

  abort(id: string, updatedAt: string, claim?: DownloadClaimRef): boolean {
    return (
      applyClaimedUpdate(
        this.db,
        `
          UPDATE download_jobs
          SET status = 'aborted',
              error_message = NULL,
              failure_kind = 'aborted',
              next_retry_at = NULL,
              owner_token = NULL,
              updated_at = ?
          WHERE id = ?
            AND status NOT IN ('completed', 'completed-with-notes', 'repairable', 'aborted')
        `,
        [updatedAt],
        id,
        claim,
      ) > 0
    );
  }

  /** Delete an unchanged inactive job and its assets as one committed aggregate. */
  deleteInactive<T>(
    job: DownloadJobRecord,
    cleanup: () => T & (T extends PromiseLike<unknown> ? never : unknown),
  ): boolean {
    return this.db
      .transaction(() => {
        const current = this.db
          .query<
            { id: string },
            [string, string, number, string, string, string | null, string | null]
          >(
            "SELECT id FROM download_jobs WHERE id = ? AND updated_at = ? AND claim_generation = ? AND status = ? AND status != 'running' AND publication_pending = 0 AND output_path = ? AND subtitle_path IS ? AND thumbnail_path IS ?",
          )
          .get(
            job.id,
            job.updatedAt,
            job.claimGeneration ?? 0,
            job.status,
            job.outputPath,
            job.subtitlePath ?? null,
            job.thumbnailPath ?? null,
          );
        if (!current) return false;
        cleanup();
        // Track/artwork references cascade with the asset. Removing the job first
        // would SET NULL on origin_job_id and make those assets unreachable.
        this.db.query("DELETE FROM offline_assets WHERE origin_job_id = ?").run(job.id);
        this.db.query("DELETE FROM download_jobs WHERE id = ?").run(job.id);
        return true;
      })
      .immediate();
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

  findBlockingEpisodeIntent(input: {
    readonly titleId: string;
    readonly season?: number;
    readonly episode?: number;
    readonly providerEpisodeIdentity?: ProviderEpisodeIdentity;
  }): DownloadJobRecord | undefined {
    const row = this.db
      .query<DownloadJobRow, [string, number | null, number | null, string | null, string | null]>(
        `
          SELECT * FROM download_jobs
          WHERE title_id = ?
            AND season IS ?
            AND episode IS ?
            AND provider_episode_provider_id IS ?
            AND provider_episode_value IS ?
            AND status IN ('queued', 'running', 'completed', 'completed-with-notes', 'repairable')
          ORDER BY updated_at DESC
          LIMIT 1
        `,
      )
      .get(
        input.titleId,
        input.season ?? null,
        input.episode ?? null,
        input.providerEpisodeIdentity?.providerId ?? null,
        input.providerEpisodeIdentity?.value ?? null,
      );
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

  /**
   * Due work only, ordered before the page limit. A page of deferred pauses
   * must not hide a job whose retry time has already passed.
   */
  listDueQueued(
    nowIso: string,
    limit: number,
    after?: { readonly createdAt: string; readonly id: string },
  ): readonly DownloadJobRecord[] {
    const due = `status = 'queued' AND (next_retry_at IS NULL OR next_retry_at <= ?)`;
    if (!after) {
      return this.db
        .query<DownloadJobRow, [string, number]>(
          `SELECT * FROM download_jobs WHERE ${due} ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .all(nowIso, limit)
        .map(mapRow);
    }
    return this.db
      .query<DownloadJobRow, [string, string, string, string, number]>(
        `SELECT * FROM download_jobs
         WHERE ${due}
           AND (created_at > ? OR (created_at = ? AND id > ?))
         ORDER BY created_at ASC, id ASC
         LIMIT ?`,
      )
      .all(nowIso, after.createdAt, after.createdAt, after.id, limit)
      .map(mapRow);
  }

  listPaused(limit = 200): readonly DownloadJobRecord[] {
    const now = new Date().toISOString();
    return this.db
      .query<DownloadJobRow, [string, number]>(
        `SELECT * FROM download_jobs
         WHERE status = 'queued'
           AND next_retry_at IS NOT NULL
           AND next_retry_at > ?
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(now, limit)
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
        "SELECT * FROM download_jobs WHERE status IN ('completed', 'completed-with-notes', 'repairable') ORDER BY completed_at DESC LIMIT ?",
      )
      .all(limit)
      .map(mapRow);
  }

  /**
   * Terminal failures only.
   *
   * 'repairable' is deliberately absent. `markRepairable` sets
   * progress_percent = 100 and stamps completed_at: the media downloaded and is
   * playable, only the sidecars failed. It is a completed download carrying
   * repair work, not a failure, so it belongs in {@link listCompleted} and is
   * swept through {@link listRepairable}. Listing it in both places is what made
   * the download manager render one job as two rows sharing an id, so
   * index-based selection acted on a phantom.
   */
  listFailed(limit = 100): readonly DownloadJobRecord[] {
    return this.db
      .query<DownloadJobRow, [number]>(
        `
          SELECT * FROM download_jobs
          WHERE status IN ('failed', 'aborted')
          ORDER BY updated_at DESC
          LIMIT ?
        `,
      )
      .all(limit)
      .map(mapRow);
  }

  /** Jobs whose media landed but whose sidecars need another pass. */
  listRepairable(limit = 100): readonly DownloadJobRecord[] {
    return this.db
      .query<DownloadJobRow, [number]>(
        `
          SELECT * FROM download_jobs
          WHERE status = 'repairable'
          ORDER BY updated_at DESC
          LIMIT ?
        `,
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
    externalIds: parseExternalIds(row.external_ids_json),
    titleName: row.title_name,
    mediaKind: row.media_kind,
    contentType: row.content_type ?? undefined,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    providerEpisodeIdentity:
      row.provider_episode_provider_id !== null && row.provider_episode_value !== null
        ? {
            providerId: row.provider_episode_provider_id,
            value: row.provider_episode_value,
          }
        : undefined,
    providerId: row.provider_id,
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
    posterUrl: row.poster_url ?? undefined,
    thumbnailPath: row.thumbnail_path ?? undefined,
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
    repairMetadataJson: row.repair_metadata_json ?? undefined,
    lastResolvedProviderId: row.last_resolved_provider_id ?? undefined,
    lastValidatedAt: row.last_validated_at ?? undefined,
    ownerToken: row.owner_token ?? undefined,
    claimGeneration: row.claim_generation,
    stagingDir: row.staging_dir ?? undefined,
    publicationPending: row.publication_pending === 1,
    publicationDevice: row.publication_dev ?? undefined,
    publicationInode: row.publication_ino ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function parseExternalIds(value: string | null): ProviderExternalIds | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as ProviderExternalIds;
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseHeaders(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

interface ClaimSeedRow {
  readonly claim_generation: number;
  readonly temp_path: string;
  readonly staging_dir: string | null;
  readonly status: string;
  readonly last_heartbeat_at: string | null;
}

function applyClaimedUpdate(
  db: KunaiDatabase,
  sql: string,
  values: readonly (string | number | null)[],
  id: string,
  claim: DownloadClaimRef | undefined,
): number {
  if (claim) {
    if (claim.jobId !== id) return 0;
    return db
      .query(`${sql} AND status = 'running' AND owner_token = ? AND claim_generation = ?`)
      .run(...values, id, claim.ownerToken, claim.generation).changes;
  }
  return db.query(sql).run(...values, id).changes;
}
