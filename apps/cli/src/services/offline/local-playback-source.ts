import type { PlaybackTimingMetadata } from "@/domain/types";
import type { DownloadJobRecord } from "@kunai/storage";

export type LocalPlaybackSource = {
  readonly kind: "local";
  readonly jobId: string;
  readonly titleId: string;
  readonly titleName: string;
  readonly mediaKind: "movie" | "series";
  readonly providerId: string;
  readonly season?: number;
  readonly episode?: number;
  readonly filePath: string;
  readonly subtitlePath?: string;
  readonly subtitleLanguage?: string;
  readonly timing?: PlaybackTimingMetadata | null;
  readonly durationMs?: number;
  readonly fileSize?: number;
  readonly qualityLabel?: string;
  readonly audioMode?: "sub" | "dub";
};

export function buildLocalPlaybackSource(
  job: DownloadJobRecord,
  timing: PlaybackTimingMetadata | null,
): LocalPlaybackSource {
  return {
    kind: "local",
    jobId: job.id,
    titleId: job.titleId,
    titleName: job.titleName,
    mediaKind: job.mediaKind === "movie" ? "movie" : "series",
    providerId: job.providerId,
    season: job.season,
    episode: job.episode,
    filePath: job.outputPath,
    subtitlePath: job.subtitlePath,
    subtitleLanguage: job.subtitleLanguage,
    timing,
    durationMs: job.durationMs,
    fileSize: job.fileSize,
    qualityLabel: job.selectedQualityLabel,
    audioMode: job.animeLang,
  };
}
