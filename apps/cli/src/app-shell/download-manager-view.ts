// =============================================================================
// download-manager-view.ts — pure layout and rail policy for the download
// manager.
//
// The shell used to recompute its own width from raw terminal columns while
// living inside a root-owned overlay whose frame had already spent some of
// them, so rows overflowed at exactly the widths people run. Splitting the
// arithmetic out makes the 72/100/140 budget assertable without mounting Ink.
// =============================================================================

import { formatMediaItemCount, presentMedia } from "@/domain/media/media-presentation";
import type { DownloadJobRecord } from "@/services/storage/storage-read-models";

import type { PreviewPosterState, PreviewRailModel } from "./primitives/PreviewRail.model";

/**
 * Gap between the list and the companion rail. This is not a free parameter: it
 * matches `MediaListShell`'s `marginLeft={2}` on the rail column. A second,
 * independent reservation here is how a layout ends up one or two columns over
 * budget on the widest surfaces.
 */
export const DOWNLOAD_MANAGER_RAIL_GAP = 2;

/** Companion rail width, matching the library shelf's rail. */
const DOWNLOAD_MANAGER_RAIL_WIDTH = 32;

/**
 * Minimum content width that can seat a list plus a rail without squeezing the
 * list below usability. Shared with `shouldRenderPreviewRail`.
 */
const DOWNLOAD_MANAGER_RAIL_MIN_COLUMNS = 124;

export type DownloadManagerLayout = {
  readonly columns: number;
  readonly listWidth: number;
  readonly railWidth: number;
  readonly showRail: boolean;
};

export function buildDownloadManagerLayout(columns: number): DownloadManagerLayout {
  const safeColumns = Math.max(1, Math.trunc(columns) || 0);
  const showRail = safeColumns >= DOWNLOAD_MANAGER_RAIL_MIN_COLUMNS;
  if (!showRail) {
    // Narrow and medium layouts are a full-width list. There is no hidden
    // reservation: every column belongs to the rows.
    return { columns: safeColumns, listWidth: safeColumns, railWidth: 0, showRail: false };
  }
  const railWidth = DOWNLOAD_MANAGER_RAIL_WIDTH;
  return {
    columns: safeColumns,
    listWidth: safeColumns - railWidth - DOWNLOAD_MANAGER_RAIL_GAP,
    railWidth,
    showRail: true,
  };
}

function jobStatusLabel(job: DownloadJobRecord): string {
  if (job.status === "running") {
    return `downloading ${Math.max(0, Math.min(100, Math.round(job.progressPercent ?? 0)))}%`;
  }
  if (job.status === "completed-with-notes") return "playable, with notes";
  return job.status;
}

/**
 * The companion rail for the settled selection.
 *
 * Artwork is the title's own poster, never an episode thumbnail: the rail
 * follows a settled selection, and a per-episode image would change identity on
 * every row even when the title has not.
 */
export function buildDownloadManagerRailModel(
  job: DownloadJobRecord | undefined,
  posterState: PreviewPosterState,
): PreviewRailModel | null {
  if (!job) return null;

  const presentation = presentMedia({
    title: job.titleName,
    mediaKind: job.mediaKind,
    season: job.season,
    episode: job.episode,
  });

  const facts = [
    { label: "Status", value: jobStatusLabel(job) },
    job.status === "running" || job.status === "queued"
      ? {
          label: "Progress",
          value: `${Math.max(0, Math.min(100, Math.round(job.progressPercent ?? 0)))}%`,
        }
      : null,
    { label: "Provider", value: job.providerId },
    job.selectedQualityLabel ? { label: "Quality", value: job.selectedQualityLabel } : null,
    { label: "Kind", value: formatMediaItemCount({ mediaKind: job.mediaKind, count: 1 }) },
    job.errorMessage ? { label: "Detail", value: job.errorMessage } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return {
    title: presentation.title,
    subtitle: presentation.positionLabel ?? presentation.kindLabel,
    posterUrl: job.posterUrl,
    posterState,
    facts,
  };
}
