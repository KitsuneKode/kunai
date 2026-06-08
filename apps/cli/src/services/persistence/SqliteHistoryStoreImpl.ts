import { migrateLegacyProviderId } from "@kunai/providers";
import { HistoryRepository } from "@kunai/storage";
import type { HistoryProgress } from "@kunai/storage";

import type { HistoryStore } from "./HistoryStore";

function normalizeHistoryProgress(progress: HistoryProgress): HistoryProgress {
  if (!progress.providerId) return progress;
  const providerId = migrateLegacyProviderId(progress.providerId);
  return providerId === progress.providerId ? progress : { ...progress, providerId };
}

export class SqliteHistoryStoreImpl implements HistoryStore {
  constructor(private readonly repository: HistoryRepository) {}

  async get(id: string): Promise<HistoryProgress | null> {
    const progress = this.repository.getLatestForTitle(id);
    return progress ? normalizeHistoryProgress(progress) : null;
  }

  async getAll(): Promise<Record<string, HistoryProgress>> {
    const entries: Record<string, HistoryProgress> = {};

    for (const progress of this.repository.listRecent(500)) {
      const normalized = normalizeHistoryProgress(progress);
      entries[normalized.titleId] ??= normalized;
    }

    return entries;
  }

  async listRecent(limit = 500): Promise<readonly [string, HistoryProgress][]> {
    return this.repository
      .listRecent(limit)
      .map((progress) => [progress.titleId, normalizeHistoryProgress(progress)] as const);
  }

  async listByTitle(id: string): Promise<readonly HistoryProgress[]> {
    return this.repository.listByTitle(id, 500).map(normalizeHistoryProgress);
  }

  async delete(id: string): Promise<void> {
    this.repository.deleteTitle(id);
  }

  async clear(): Promise<void> {
    this.repository.clear();
  }
}
