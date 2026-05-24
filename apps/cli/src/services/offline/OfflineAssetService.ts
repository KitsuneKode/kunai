import type {
  DownloadJobRecord,
  OfflineAssetRecord,
  OfflineAssetsRepository,
  OfflineAssetState,
  OfflineNextReadyCursor,
} from "@kunai/storage";

export type RecordedOfflineStatus = {
  readonly titleId: string;
  readonly status: OfflineAssetState;
};

export class OfflineAssetService {
  constructor(private readonly assets: OfflineAssetsRepository) {}

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

  adoptCompletedJob(job: DownloadJobRecord): OfflineAssetRecord | null {
    if (job.status !== "completed" && job.status !== "completed-with-notes") return null;
    const state = recordedAssetState(job);
    return this.assets.upsertPlayable({
      titleId: job.titleId,
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
  if (job.status === "completed-with-notes" || job.status === "repairable") return "repairable";
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
