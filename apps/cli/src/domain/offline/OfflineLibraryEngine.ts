import {
  formatOfflineLibraryGroupDetail,
  formatOfflineShelfBadge,
  formatOfflineShelfDetail,
  groupOfflineLibraryEntries,
  type OfflineLibraryEntry,
} from "@/services/offline/offline-library";

export type OfflineLibraryShelfEntry = {
  readonly jobId: string;
  readonly episodeLabel: string;
  readonly badge: string;
  readonly detail: string;
  readonly previewImageUrl?: string;
  readonly playable: boolean;
};

export type OfflineLibraryShelfGroup = {
  readonly key: string;
  readonly titleId: string;
  readonly titleName: string;
  readonly label: string;
  readonly detail: string;
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
      const groups = groupOfflineLibraryEntries(entries).map((group) => ({
        key: group.key,
        titleId: group.titleId,
        titleName: group.titleName,
        label: group.titleName,
        detail: formatOfflineLibraryGroupDetail(group),
        readyCount: group.readyCount,
        issueCount: group.issueCount,
        previewImageUrl: group.previewImageUrl,
        entries: group.entries.map((entry) => ({
          jobId: entry.job.id,
          episodeLabel: formatEpisodeLabel(entry),
          badge: formatOfflineShelfBadge(entry.job, entry.status),
          detail: formatOfflineShelfDetail(entry.job, entry.status),
          previewImageUrl: entry.job.thumbnailPath ?? entry.job.posterUrl,
          playable: entry.status === "ready",
        })),
      }));

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

function formatEpisodeLabel(entry: OfflineLibraryEntry): string {
  const { job } = entry;
  if (job.season !== undefined && job.episode !== undefined) {
    return `S${String(job.season).padStart(2, "0")}E${String(job.episode).padStart(2, "0")}`;
  }
  return job.mediaKind === "movie" ? "movie" : "episode";
}
