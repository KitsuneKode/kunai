import { access, constants, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

import type { PlaybackTimingMetadata } from "@/domain/types";
import type { DownloadJobRecord } from "@kunai/storage";

export type OfflineArtifactStatus = "ready" | "missing" | "invalid-file";

export type OfflineLibraryEntry = {
  readonly job: DownloadJobRecord;
  readonly status: OfflineArtifactStatus;
};

export async function resolveOfflineArtifactStatus(
  job: DownloadJobRecord,
): Promise<OfflineArtifactStatus> {
  try {
    await access(job.outputPath, constants.R_OK);
    const fileStat = await stat(job.outputPath);
    if (!fileStat.isFile() || fileStat.size <= 0) return "invalid-file";
    return "ready";
  } catch {
    return "missing";
  }
}

export async function hydrateCompletedOfflineJobs(
  jobs: readonly DownloadJobRecord[],
): Promise<OfflineLibraryEntry[]> {
  return Promise.all(
    jobs.map(async (job) => ({
      job,
      status: await resolveOfflineArtifactStatus(job),
    })),
  );
}

/** Short label for pickers; matches `/downloads` completed row style. */
export function formatOfflineJobListingTitle(job: DownloadJobRecord): string {
  const episodeLabel =
    job.season !== undefined && job.episode !== undefined
      ? `S${String(job.season).padStart(2, "0")}E${String(job.episode).padStart(2, "0")}`
      : "movie";
  return `${job.titleName}  ·  ${episodeLabel}`;
}

export function formatOfflineSecondaryLine(
  job: DownloadJobRecord,
  status: OfflineArtifactStatus,
): string {
  const sizeMb =
    typeof job.fileSize === "number" ? `${(job.fileSize / 1_048_576).toFixed(1)} MB` : null;
  const subtitleLabel = job.subtitlePath ? "subtitles cached" : "no subtitles cached";
  const parts = [
    `${offlineStatusLabel(status)}`,
    sizeMb,
    subtitleLabel,
    basename(dirname(job.outputPath)),
  ].filter(Boolean);
  return parts.join("  ·  ");
}

export function offlineStatusIcon(status: OfflineArtifactStatus): string {
  if (status === "ready") return "✓";
  if (status === "missing") return "!";
  return "×";
}

function offlineStatusLabel(status: OfflineArtifactStatus): string {
  if (status === "ready") return "ready";
  if (status === "missing") return "missing";
  return "invalid-file";
}

export function parseIntroSkipTiming(introSkipJson?: string): PlaybackTimingMetadata | null {
  if (!introSkipJson) return null;
  try {
    return JSON.parse(introSkipJson) as PlaybackTimingMetadata;
  } catch {
    return null;
  }
}
