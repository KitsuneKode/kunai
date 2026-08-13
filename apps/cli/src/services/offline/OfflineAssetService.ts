import type {
  DownloadJobRecord,
  OfflineAssetRecord,
  OfflineAssetsRepository,
  OfflineAssetState,
  OfflineNextReadyCursor,
} from "@kunai/storage";

import type { OfflineTitleIdentity } from "./offline-title-identity";

export type RecordedOfflineStatus = {
  readonly titleId: string;
  readonly status: OfflineAssetState;
};

export class OfflineAssetService {
  constructor(
    private readonly assets: OfflineAssetsRepository,
    private readonly titleIdentity: OfflineTitleIdentity,
  ) {}

  getAsset(id: string): OfflineAssetRecord | undefined {
    return this.assets.get(id);
  }

  listTitleAssets(titleId: string): readonly OfflineAssetRecord[] {
    return this.assets.listTitleAssets(titleId);
  }

  listByTitleIds(titleIds: readonly string[]): readonly OfflineAssetRecord[] {
    return this.assets.listByTitleIds(titleIds);
  }

  listNextReadyByTitleCursors(
    cursors: readonly OfflineNextReadyCursor[],
  ): readonly OfflineAssetRecord[] {
    return this.assets.listNextReadyByTitleCursors(cursors);
  }

  markValidation(id: string, state: OfflineAssetState, validatedAt: string): void {
    this.assets.markValidation(id, state, validatedAt);
  }

  removeForJob(jobId: string): void {
    this.assets.deleteByOriginJobId(jobId);
  }

  /**
   * Drops assets left ownerless by an earlier delete, returning how many.
   *
   * Job deletion once removed the row before the cleanup listener ran, and
   * `origin_job_id` is `ON DELETE SET NULL`, so the asset survived as `ready`
   * with no owner — advertised as downloaded, impossible to play. Deletion now
   * emits first, so this only repairs libraries damaged before that fix; it is
   * a no-op afterwards. Job-driven validation cannot reach these rows, because
   * it iterates jobs and these have none.
   */
  purgeOrphanedAssets(): number {
    return this.assets.deleteOrphaned();
  }

  adoptCompletedJob(job: DownloadJobRecord): OfflineAssetRecord | null {
    if (
      job.status !== "completed" &&
      job.status !== "completed-with-notes" &&
      job.status !== "repairable"
    ) {
      return null;
    }
    const state = recordedAssetState(job);
    return this.assets.upsertPlayable({
      // Resolved, not verbatim: every read resolves the same way, so an asset
      // can only be filed under an id a read will actually ask for.
      titleId: this.titleIdentity.resolveForJob(job),
      titleName: job.titleName,
      mediaKind: job.mediaKind,
      season: job.season,
      episode: job.episode,
      profileKey: profileKeyForJob(job),
      originJobId: job.id,
      filePath: job.outputPath,
      state,
      byteSize: job.fileSize,
      durationMs: job.durationMs,
      timingJson: job.introSkipJson,
      lastValidatedAt: job.lastValidatedAt,
      updatedAt: job.updatedAt,
    });
  }

  peekStatusesByTitleIds(titleIds: readonly string[]): readonly RecordedOfflineStatus[] {
    return this.assets.listByTitleIds(titleIds).map((asset) => ({
      titleId: asset.titleId,
      status: asset.state,
    }));
  }
}

function recordedAssetState(job: DownloadJobRecord): OfflineAssetState {
  if (job.artifactStatus === "missing" || job.artifactStatus === "invalid-file") {
    return job.artifactStatus;
  }
  return "ready";
}

function profileKeyForJob(job: DownloadJobRecord): string {
  return [
    job.mode ?? job.mediaKind,
    job.animeLang ?? "original",
    job.subLang ?? "none",
    job.selectedQualityLabel ?? "best",
  ].join(":");
}
