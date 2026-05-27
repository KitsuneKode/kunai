import { projectWatchProgress } from "@/domain/continuation/watch-progress";

export interface StoredPlaylistItemProjectionInput {
  readonly id: string;
  readonly playlistId: string;
  readonly titleId: string;
  readonly mediaKind: string;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly sortOrder: number;
  readonly addedAt: string;
}

export interface PlaylistProgressProjectionInput {
  readonly titleId: string;
  readonly mediaKind: string;
  readonly season?: number;
  readonly episode?: number;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly completed: boolean;
}

export interface ProjectedPlaylistItem extends StoredPlaylistItemProjectionInput {
  readonly progressPercent?: number;
  readonly completed?: boolean;
}

export function projectPlaylistItems({
  items,
  progress,
}: {
  readonly items: readonly StoredPlaylistItemProjectionInput[];
  readonly progress: readonly PlaylistProgressProjectionInput[];
}): readonly ProjectedPlaylistItem[] {
  return items.map((item) => {
    const match = progress.find(
      (entry) =>
        entry.titleId === item.titleId &&
        entry.mediaKind === item.mediaKind &&
        entry.season === item.season &&
        entry.episode === item.episode,
    );
    if (!match) return item;
    const projection = projectWatchProgress({
      timestamp: match.positionSeconds,
      duration: match.durationSeconds,
      completed: match.completed,
    });
    const progressPercent = projection.percentage ?? undefined;
    return {
      ...item,
      progressPercent,
      completed: projection.completed,
    };
  });
}
