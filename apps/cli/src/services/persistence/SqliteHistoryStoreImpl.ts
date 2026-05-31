import { HistoryRepository } from "@kunai/storage";
import type { HistoryProgress } from "@kunai/storage";

import type { HistoryStore } from "./HistoryStore";

export class SqliteHistoryStoreImpl implements HistoryStore {
  constructor(private readonly repository: HistoryRepository) {}

  async get(id: string): Promise<HistoryProgress | null> {
    return this.repository.getLatestForTitle(id) ?? null;
  }

  async getAll(): Promise<Record<string, HistoryProgress>> {
    const entries: Record<string, HistoryProgress> = {};

    for (const progress of this.repository.listRecent(500)) {
      entries[progress.titleId] ??= progress;
    }

    return entries;
  }

  async listRecent(limit = 500): Promise<readonly [string, HistoryProgress][]> {
    return this.repository
      .listRecent(limit)
      .map((progress) => [progress.titleId, progress] as const);
  }

  async listByTitle(id: string): Promise<readonly HistoryProgress[]> {
    return this.repository.listByTitle(id, 500);
  }

  async delete(id: string): Promise<void> {
    this.repository.deleteTitle(id);
  }

  async clear(): Promise<void> {
    this.repository.clear();
  }
}
