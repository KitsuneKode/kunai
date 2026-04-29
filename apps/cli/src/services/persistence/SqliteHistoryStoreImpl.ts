import { HistoryRepository } from "@kunai/storage";
import type { HistoryProgress } from "@kunai/storage";

import type { HistoryEntry, HistoryStore } from "./HistoryStore";

export class SqliteHistoryStoreImpl implements HistoryStore {
  constructor(private readonly repository: HistoryRepository) {}

  async get(id: string): Promise<HistoryEntry | null> {
    const progress = this.repository.getLatestForTitle(id);
    return progress === undefined ? null : toHistoryEntry(progress);
  }

  async getAll(): Promise<Record<string, HistoryEntry>> {
    const entries: Record<string, HistoryEntry> = {};

    for (const progress of this.repository.listRecent(500)) {
      entries[progress.titleId] ??= toHistoryEntry(progress);
    }

    return entries;
  }

  async listByTitle(id: string): Promise<readonly HistoryEntry[]> {
    return this.repository.listByTitle(id, 500).map(toHistoryEntry);
  }

  async save(id: string, entry: HistoryEntry): Promise<void> {
    this.repository.upsertProgress({
      title: {
        id,
        kind: entry.type,
        title: entry.title,
      },
      episode: {
        season: entry.season,
        episode: entry.episode,
      },
      positionSeconds: entry.timestamp,
      durationSeconds: entry.duration,
      completed: entry.completed || (entry.duration > 0 && entry.timestamp / entry.duration >= 0.9),
      providerId: entry.provider,
      updatedAt: entry.watchedAt,
    });
  }

  async delete(id: string): Promise<void> {
    this.repository.deleteTitle(id);
  }

  async clear(): Promise<void> {
    this.repository.clear();
  }
}

function toHistoryEntry(progress: HistoryProgress): HistoryEntry {
  return {
    title: progress.title,
    type: progress.mediaKind === "movie" ? "movie" : "series",
    season: progress.season ?? 1,
    episode: progress.episode ?? progress.absoluteEpisode ?? 1,
    timestamp: progress.positionSeconds,
    duration: progress.durationSeconds ?? 0,
    completed: progress.completed,
    provider: progress.providerId ?? "unknown",
    watchedAt: progress.updatedAt,
  };
}
