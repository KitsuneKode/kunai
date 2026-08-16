import { presentMedia } from "@/domain/media/media-presentation";
import type { ContentType } from "@/domain/types";
import type { DownloadJobRecord } from "@kunai/storage";

export type PlaybackDownloadMatchInput = {
  readonly titleId: string;
  readonly contentType: ContentType;
  readonly season?: number;
  readonly episode?: number;
};

/** Prefer the job for the episode being viewed; fall back to any active job for the title when episode context is absent. */
export function pickActiveDownloadForPlayback(
  jobs: readonly DownloadJobRecord[],
  input: PlaybackDownloadMatchInput,
): DownloadJobRecord | undefined {
  const sameTitle = jobs.filter((job) => job.titleId === input.titleId);
  if (sameTitle.length === 0) return undefined;

  if (input.contentType === "movie") {
    return sameTitle[0];
  }

  const { season, episode } = input;
  if (
    typeof season === "number" &&
    Number.isFinite(season) &&
    typeof episode === "number" &&
    Number.isFinite(episode)
  ) {
    const exact = sameTitle.find((job) => job.season === season && job.episode === episode);
    if (exact) return exact;
  }

  return sameTitle[0];
}

export function formatPlaybackDownloadStripe(job: DownloadJobRecord): string {
  const { positionLabel, kindLabel } = presentMedia({
    title: job.titleName,
    mediaKind: job.mediaKind,
    contentType: job.contentType,
    season: job.season,
    episode: job.episode,
  });
  const episodeLabel = positionLabel ?? kindLabel;
  const statusLabel =
    job.status === "running"
      ? `downloading ${job.progressPercent}%`
      : job.status === "queued"
        ? "queued"
        : job.status;
  return `${episodeLabel}  ·  ${statusLabel}`;
}
