import { shouldPersistHistory, toHistoryTimestamp } from "@/app/playback-history";
import { didPlaybackReachCompletionThreshold } from "@/app/playback-policy";
import type { PlaybackResult } from "@/domain/types";
import type { DownloadService } from "@/services/download/DownloadService";
import type { HistoryStore } from "@/services/persistence/HistoryStore";
import type { DownloadJobRecord } from "@kunai/storage";

import { buildLocalPlaybackSource, type LocalPlaybackSource } from "./local-playback-source";
import {
  hydrateCompletedOfflineJobs,
  parseIntroSkipTiming,
  resolveOfflineArtifactStatus,
  type OfflineLibraryEntry,
} from "./offline-library";

export type OfflineLibraryServiceDeps = {
  readonly downloadService: DownloadService;
  readonly historyStore: HistoryStore;
};

export class OfflineLibraryService {
  constructor(private readonly deps: OfflineLibraryServiceDeps) {}

  async listCompletedEntries(limit = 60): Promise<readonly OfflineLibraryEntry[]> {
    return this.validateCompletedArtifacts(limit);
  }

  async validateCompletedArtifacts(limit = 60): Promise<readonly OfflineLibraryEntry[]> {
    const completed = dedupeCompletedJobs(
      this.deps.downloadService.listCompleted(Math.max(limit * 2, 1)),
    ).slice(0, limit);
    return hydrateCompletedOfflineJobs(completed);
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
    if (job.status !== "completed") return { status: "not-completed", job };

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

    await this.deps.historyStore.save(source.titleId, {
      title: source.titleName,
      type: source.mediaKind,
      season: source.season ?? 1,
      episode: source.episode ?? 1,
      timestamp: toHistoryTimestamp(result, timing),
      duration: result.duration,
      completed: didPlaybackReachCompletionThreshold(result, timing),
      provider: `local:${source.providerId}`,
      watchedAt: new Date().toISOString(),
    });
    return true;
  }
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
  return deduped;
}
