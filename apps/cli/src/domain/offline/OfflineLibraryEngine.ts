import {
  formatMediaItemCount,
  presentMedia,
  type MediaPresentation,
} from "@/domain/media/media-presentation";
import {
  formatOfflineLibraryGroupDetail,
  formatOfflineShelfBadge,
  formatOfflineShelfDetail,
  groupOfflineLibraryEntries,
  type OfflineLibraryEntry,
} from "@/services/offline/offline-library";

export type OfflineLibraryShelfEntry = {
  readonly jobId: string;
  /**
   * Canonical facts, not display text. The library shell used to read season
   * identity back out of a formatted label with a regex, which meant a movie
   * stored with a synthetic season 1 rendered a season the user does not have.
   */
  readonly presentation: MediaPresentation;
  readonly badge: string;
  readonly detail: string;
  readonly previewImageUrl?: string;
  readonly playable: boolean;
};

export type OfflineLibraryShelfGroup = {
  readonly key: string;
  readonly titleId: string;
  readonly titleName: string;
  /** Authoritative content kind, so the shell never re-derives it from copy. */
  readonly mediaKind: OfflineLibraryEntry["job"]["mediaKind"];
  /** Catalog structure controls title-level versus episodic copy. */
  readonly contentType?: OfflineLibraryEntry["job"]["contentType"];
  readonly label: string;
  readonly detail: string;
  readonly nextPlayableEpisodeLabel?: string;
  readonly actionSummary: string;
  readonly artifactSummary: string;
  readonly readyCount: number;
  readonly issueCount: number;
  readonly previewImageUrl?: string;
  readonly entries: readonly OfflineLibraryShelfEntry[];
};

export type OfflineLibraryShelf = {
  readonly summary: string;
  readonly groups: readonly OfflineLibraryShelfGroup[];
  readonly emptyActions: readonly string[];
};

export type OfflineLibraryEngine = {
  buildShelf(entries: readonly OfflineLibraryEntry[]): OfflineLibraryShelf;
};

export function createOfflineLibraryEngine(): OfflineLibraryEngine {
  return {
    buildShelf(entries) {
      const groups = groupOfflineLibraryEntries(entries).map((group) => {
        const shelfEntries = group.entries.map((entry) => ({
          jobId: entry.job.id,
          presentation: presentMedia({
            title: entry.job.titleName,
            mediaKind: entry.job.mediaKind,
            contentType: group.contentType ?? entry.job.contentType,
            season: entry.job.season,
            episode: entry.job.episode,
          }),
          badge: formatOfflineShelfBadge(entry.job, entry.status),
          detail: formatOfflineShelfDetail(entry.job, entry.status, group.contentType),
          previewImageUrl: entry.job.thumbnailPath ?? entry.job.posterUrl,
          playable: entry.status === "ready",
        }));
        const nextPlayable = shelfEntries.find((entry) => entry.playable)?.presentation;
        const nextPlayableEpisodeLabel = nextPlayable
          ? (nextPlayable.positionLabel ?? nextPlayable.kindLabel)
          : undefined;

        return {
          key: group.key,
          titleId: group.titleId,
          titleName: group.titleName,
          mediaKind: group.mediaKind,
          contentType: group.contentType,
          label: group.titleName,
          detail: formatOfflineLibraryGroupDetail(group),
          nextPlayableEpisodeLabel,
          actionSummary: formatActionSummary({
            nextPlayableEpisodeLabel,
            issueCount: group.issueCount,
            entryCount: group.entries.length,
            mediaKind: group.mediaKind,
            contentType: group.contentType,
          }),
          artifactSummary: formatArtifactSummary(group.entries),
          readyCount: group.readyCount,
          issueCount: group.issueCount,
          previewImageUrl: group.previewImageUrl,
          entries: shelfEntries,
        };
      });

      return {
        summary:
          entries.length > 0
            ? `${groups.length} ${groups.length === 1 ? "title" : "titles"} · ${
                entries.length
              } local ${entries.length === 1 ? "item" : "items"} · local-only`
            : "No completed local videos yet",
        groups,
        emptyActions: ["Open downloads queue", "Search online"],
      };
    },
  };
}

function formatActionSummary(input: {
  readonly nextPlayableEpisodeLabel?: string;
  readonly issueCount: number;
  readonly entryCount: number;
  readonly mediaKind: OfflineLibraryEntry["job"]["mediaKind"];
  readonly contentType?: OfflineLibraryEntry["job"]["contentType"];
}): string {
  const parts = [
    input.nextPlayableEpisodeLabel ? `Play ${input.nextPlayableEpisodeLabel}` : "No playable files",
    `inspect ${formatMediaItemCount({
      mediaKind: input.mediaKind,
      contentType: input.contentType,
      count: input.entryCount,
    })}`,
    input.issueCount > 0
      ? `repair ${input.issueCount} ${input.issueCount === 1 ? "issue" : "issues"}`
      : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatArtifactSummary(entries: readonly OfflineLibraryEntry[]): string {
  const hasArtwork = entries.some((entry) => entry.job.thumbnailPath || entry.job.posterUrl);
  const hasSubtitles = entries.some((entry) => entry.job.subtitlePath);
  const hasTiming = entries.some((entry) => entry.job.introSkipJson);

  return [
    hasArtwork ? "artwork ready" : "artwork missing",
    hasSubtitles ? "subtitles cached" : "subtitles missing",
    hasTiming ? "timing cached" : "timing missing",
  ].join(" · ");
}
