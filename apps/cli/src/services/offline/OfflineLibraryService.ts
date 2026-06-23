import { shouldPersistHistory, toHistoryTimestamp } from "@/domain/playback/playback-history";
import { didPlaybackReachCompletionThreshold } from "@/domain/playback/playback-policy";
import type { PlaybackResult } from "@/domain/types";
import type { DownloadService } from "@/services/download/DownloadService";
import type { DownloadJobRecord, HistoryRepository } from "@kunai/storage";

import { buildLocalPlaybackSource, type LocalPlaybackSource } from "./local-playback-source";
import {
  parseIntroSkipTiming,
  resolveOfflineArtifactStatus,
  type OfflineArtifactStatus,
  type OfflineLibraryEntry,
} from "./offline-library";
import type { OfflineAssetService, RecordedOfflineStatus } from "./OfflineAssetService";

const ARTIFACT_CACHE_TTL_MS = 5 * 60 * 1000;

function isArtifactCacheFresh(job: DownloadJobRecord): boolean {
  if (!job.lastValidatedAt) return false;
  return Date.now() - new Date(job.lastValidatedAt).getTime() < ARTIFACT_CACHE_TTL_MS;
}

export type OfflineLibraryServiceDeps = {
  readonly downloadService: DownloadService;
  readonly historyRepository: Pick<HistoryRepository, "upsertProgress">;
  readonly offlineAssetService?: OfflineAssetService;
};

export class OfflineLibraryService {
  constructor(private readonly deps: OfflineLibraryServiceDeps) {}

  async peekRecordedArtifactStatuses(
    titleIds: readonly string[],
    limit = 300,
  ): Promise<readonly RecordedOfflineStatus[]> {
    if (this.deps.offlineAssetService) {
      return this.deps.offlineAssetService.peekStatusesByTitleIds(titleIds);
    }
    const wanted = new Set(titleIds);
    if (wanted.size === 0) return [];
    return dedupeCompletedJobs(this.deps.downloadService.listCompleted(limit))
      .filter((job) => wanted.has(job.titleId) && isOfflineArtifactStatus(job.artifactStatus))
      .map((job) => ({
        titleId: job.titleId,
        status: job.artifactStatus as OfflineArtifactStatus,
      }));
  }

  async listCompletedEntries(limit = 60): Promise<readonly OfflineLibraryEntry[]> {
    return this.validateCompletedArtifacts(limit);
  }

  async validateCompletedArtifacts(limit = 60): Promise<readonly OfflineLibraryEntry[]> {
    const completed = dedupeCompletedJobs(
      this.deps.downloadService.listCompleted(Math.max(limit * 2, 1)),
    ).slice(0, limit);

    const entries: OfflineLibraryEntry[] = [];
    for (const job of completed) {
      if (isArtifactCacheFresh(job) && isOfflineArtifactStatus(job.artifactStatus)) {
        entries.push({
          job,
          status: job.artifactStatus,
        });
        continue;
      }
      const status = await resolveOfflineArtifactStatus(job);
      this.deps.downloadService.markArtifactValidated(job.id, status);
      entries.push({ job, status });
    }
    return entries;
  }

  async getPlayableSource(jobId: string): Promise<
    | {
        readonly status: "ready";
        readonly job: DownloadJobRecord;
        readonly source: LocalPlaybackSource;
      }
    | {
        readonly status: "missing" | "invalid-file" | "not-found" | "not-completed";
        readonly job?: DownloadJobRecord;
      }
  > {
    const job = this.deps.downloadService.getJob(jobId);
    if (!job) return { status: "not-found" };
    if (job.status !== "completed" && job.status !== "completed-with-notes") {
      return { status: "not-completed", job };
    }

    const artifactStatus = await resolveOfflineArtifactStatus(job);
    if (artifactStatus !== "ready") return { status: artifactStatus, job };

    return {
      status: "ready",
      job,
      source: buildLocalPlaybackSource(job, parseIntroSkipTiming(job.introSkipJson)),
    };
  }

  async savePlaybackHistory(source: LocalPlaybackSource, result: PlaybackResult): Promise<boolean> {
    const timing = source.timing ?? null;
    if (!shouldPersistHistory(result, timing)) return false;

    this.deps.historyRepository.upsertProgress({
      title: { id: source.titleId, kind: source.mediaKind, title: source.titleName },
      episode: { season: source.season ?? 1, episode: source.episode ?? 1 },
      positionSeconds: toHistoryTimestamp(result, timing),
      durationSeconds: result.duration,
      completed: didPlaybackReachCompletionThreshold(result, timing),
      providerId: `local:${source.providerId}`,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
}

function isOfflineArtifactStatus(value: unknown): value is OfflineArtifactStatus {
  return value === "ready" || value === "missing" || value === "invalid-file";
}

function dedupeCompletedJobs(jobs: readonly DownloadJobRecord[]): readonly DownloadJobRecord[] {
  const seen = new Set<string>();
  const ordered = [...jobs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const deduped: DownloadJobRecord[] = [];
  for (const job of ordered) {
    const key = [
      job.titleId,
      job.mediaKind,
      job.season ?? "movie",
      job.episode ?? "movie",
      job.outputPath,
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(job);
  }
  // Dedup keeps the newest copy of each episode (time sort above), but the
  // library should READ in natural season → episode order, not download order.
  return deduped.sort(compareBySeasonEpisode);
}

/** Season asc, then episode asc; movies (no season/episode) sink to the end by title. */
function compareBySeasonEpisode(a: DownloadJobRecord, b: DownloadJobRecord): number {
  const seasonA = a.season ?? Number.MAX_SAFE_INTEGER;
  const seasonB = b.season ?? Number.MAX_SAFE_INTEGER;
  if (seasonA !== seasonB) return seasonA - seasonB;
  const episodeA = a.episode ?? Number.MAX_SAFE_INTEGER;
  const episodeB = b.episode ?? Number.MAX_SAFE_INTEGER;
  if (episodeA !== episodeB) return episodeA - episodeB;
  return a.titleId.localeCompare(b.titleId);
}
