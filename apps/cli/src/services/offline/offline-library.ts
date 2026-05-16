import { access, constants, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

import type { PlaybackTimingMetadata } from "@/domain/types";
import type { DownloadJobRecord } from "@kunai/storage";

export type OfflineArtifactStatus = "ready" | "missing" | "invalid-file";

export type OfflineLibraryEntry = {
  readonly job: DownloadJobRecord;
  readonly status: OfflineArtifactStatus;
};

export type OfflineArtworkPolicy = {
  readonly networkAvailable?: boolean;
  readonly artworkPreviewsEnabled?: boolean;
  readonly allowRemoteArtwork?: boolean;
};

export type OfflineLibraryGroup = {
  readonly key: string;
  readonly titleId: string;
  readonly titleName: string;
  readonly mediaKind: DownloadJobRecord["mediaKind"];
  readonly entries: readonly OfflineLibraryEntry[];
  readonly readyCount: number;
  readonly issueCount: number;
  readonly totalSize: number | null;
  readonly latestCompletedAt: string;
  readonly previewImageUrl?: string;
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

export function groupOfflineLibraryEntries(
  entries: readonly OfflineLibraryEntry[],
  artworkPolicy: OfflineArtworkPolicy = {},
): readonly OfflineLibraryGroup[] {
  const groups = new Map<string, OfflineLibraryEntry[]>();
  for (const entry of entries) {
    const key = `${entry.job.titleId || entry.job.titleName}:${entry.job.mediaKind}`;
    const current = groups.get(key) ?? [];
    current.push(entry);
    groups.set(key, current);
  }

  const libraryGroups: OfflineLibraryGroup[] = [];
  for (const [key, groupEntries] of groups.entries()) {
    const sortedEntries = [...groupEntries].sort(compareOfflineEntries);
    const first = sortedEntries[0]?.job;
    if (!first) continue;
    const fileSizes = sortedEntries
      .map((entry) => entry.job.fileSize)
      .filter((size): size is number => typeof size === "number");
    const latestCompletedAt = sortedEntries
      .map((entry) => entry.job.completedAt ?? entry.job.updatedAt)
      .sort()
      .at(-1);

    libraryGroups.push({
      key,
      titleId: first.titleId,
      titleName: first.titleName,
      mediaKind: first.mediaKind,
      entries: sortedEntries,
      readyCount: sortedEntries.filter((entry) => entry.status === "ready").length,
      issueCount: sortedEntries.filter((entry) => entry.status !== "ready").length,
      totalSize: fileSizes.length > 0 ? fileSizes.reduce((total, size) => total + size, 0) : null,
      latestCompletedAt: latestCompletedAt ?? first.updatedAt,
      previewImageUrl: resolveOfflinePreviewImage(sortedEntries, artworkPolicy),
    });
  }

  return libraryGroups.sort(
    (a, b) => Date.parse(b.latestCompletedAt) - Date.parse(a.latestCompletedAt),
  );
}

export function formatOfflineLibraryGroupLabel(group: OfflineLibraryGroup): string {
  const itemLabel =
    group.mediaKind === "movie"
      ? `${group.entries.length} ${group.entries.length === 1 ? "movie" : "movies"}`
      : `${group.entries.length} ${group.entries.length === 1 ? "episode" : "episodes"}`;
  return `${group.titleName}  ·  ${itemLabel}`;
}

export function formatOfflineLibraryGroupDetail(group: OfflineLibraryGroup): string {
  const parts = [
    `${group.readyCount} ready`,
    group.issueCount > 0 ? `${group.issueCount} needs attention` : null,
    group.totalSize !== null ? `${(group.totalSize / 1_048_576).toFixed(1)} MB local` : null,
    group.previewImageUrl ? "artwork ready" : null,
    group.entries.some((entry) => entry.job.introSkipJson) ? "timing cached" : null,
    formatOfflineRange(group.entries),
  ].filter(Boolean);
  return parts.join("  ·  ");
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
  const timingLabel = job.introSkipJson ? "timing cached" : null;
  const artworkLabel = job.thumbnailPath
    ? "thumbnail ready"
    : job.posterUrl
      ? "poster cached"
      : null;
  const parts = [
    `${offlineStatusLabel(status)}`,
    sizeMb,
    subtitleLabel,
    timingLabel,
    artworkLabel,
    basename(dirname(job.outputPath)),
  ].filter(Boolean);
  return parts.join("  ·  ");
}

export function formatOfflineShelfBadge(
  _job: DownloadJobRecord,
  status: OfflineArtifactStatus,
): string {
  if (status === "ready") return "offline ready";
  if (status === "missing") return "file missing";
  return "needs repair";
}

export function formatOfflineShelfDetail(
  job: DownloadJobRecord,
  status: OfflineArtifactStatus,
): string {
  const parts = [
    formatOfflineEpisodeLabel(job),
    typeof job.fileSize === "number" ? `${(job.fileSize / 1_048_576).toFixed(1)} MB` : null,
    job.subtitlePath ? "subtitles cached" : "no subtitles cached",
    job.introSkipJson ? "timing cached" : null,
    job.thumbnailPath ? "thumbnail ready" : job.posterUrl ? "poster cached" : null,
    status === "ready" ? basename(dirname(job.outputPath)) : offlineStatusLabel(status),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function resolveOfflineJobPreviewImage(
  job: DownloadJobRecord,
  artworkPolicy: OfflineArtworkPolicy = {},
): string | undefined {
  if (job.thumbnailPath) return job.thumbnailPath;
  if (canUseRemoteArtwork(artworkPolicy)) return job.posterUrl;
  return undefined;
}

function resolveOfflinePreviewImage(
  entries: readonly OfflineLibraryEntry[],
  artworkPolicy: OfflineArtworkPolicy,
): string | undefined {
  return (
    entries.find((entry) => entry.job.thumbnailPath)?.job.thumbnailPath ??
    (canUseRemoteArtwork(artworkPolicy)
      ? entries.find((entry) => entry.job.posterUrl)?.job.posterUrl
      : undefined)
  );
}

function canUseRemoteArtwork(policy: OfflineArtworkPolicy): boolean {
  return (
    policy.allowRemoteArtwork === true ||
    (policy.networkAvailable === true && policy.artworkPreviewsEnabled !== false)
  );
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

function formatOfflineEpisodeLabel(job: DownloadJobRecord): string {
  if (job.season !== undefined && job.episode !== undefined) {
    return `S${String(job.season).padStart(2, "0")}E${String(job.episode).padStart(2, "0")}`;
  }
  return job.mediaKind === "movie" ? "movie" : "episode";
}

function compareOfflineEntries(left: OfflineLibraryEntry, right: OfflineLibraryEntry): number {
  const seasonDelta = (left.job.season ?? 0) - (right.job.season ?? 0);
  if (seasonDelta !== 0) return seasonDelta;
  const episodeDelta = (left.job.episode ?? 0) - (right.job.episode ?? 0);
  if (episodeDelta !== 0) return episodeDelta;
  return left.job.titleName.localeCompare(right.job.titleName);
}

function formatOfflineRange(entries: readonly OfflineLibraryEntry[]): string | null {
  const numbered = entries
    .map((entry) => entry.job)
    .filter(
      (job): job is DownloadJobRecord & { season: number; episode: number } =>
        typeof job.season === "number" && typeof job.episode === "number",
    );
  if (numbered.length === 0) return null;
  const first = numbered[0];
  const last = numbered[numbered.length - 1];
  if (!first || !last) return null;
  if (numbered.length === 1) return formatOfflineEpisodeLabel(first);
  const sameSeason = first.season === last.season;
  return sameSeason
    ? `S${String(first.season).padStart(2, "0")}E${String(first.episode).padStart(
        2,
        "0",
      )}-E${String(last.episode).padStart(2, "0")}`
    : `${formatOfflineEpisodeLabel(first)}-${formatOfflineEpisodeLabel(last)}`;
}

export function parseIntroSkipTiming(introSkipJson?: string): PlaybackTimingMetadata | null {
  if (!introSkipJson) return null;
  try {
    return JSON.parse(introSkipJson) as PlaybackTimingMetadata;
  } catch {
    return null;
  }
}
