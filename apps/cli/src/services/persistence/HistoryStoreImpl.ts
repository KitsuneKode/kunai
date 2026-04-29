// =============================================================================
// History Store Implementation
// =============================================================================

import type { HistoryStore, HistoryEntry } from "./HistoryStore";
import type { StorageService } from "../../infra/storage/StorageService";

const STORAGE_KEY = "history";

export class HistoryStoreImpl implements HistoryStore {
  constructor(private storage: StorageService) {}

  async get(id: string): Promise<HistoryEntry | null> {
    const all = await this.getAll();
    return all[id] ?? null;
  }

  async getAll(): Promise<Record<string, HistoryEntry>> {
    return (await this.storage.read<Record<string, HistoryEntry>>(STORAGE_KEY)) ?? {};
  }

  async listByTitle(id: string): Promise<readonly HistoryEntry[]> {
    const entry = await this.get(id);
    return entry ? [entry] : [];
  }

  async save(id: string, entry: HistoryEntry): Promise<void> {
    const all = await this.getAll();
    all[id] = entry;
    await this.storage.write(STORAGE_KEY, all);
  }

  async delete(id: string): Promise<void> {
    const all = await this.getAll();
    delete all[id];
    await this.storage.write(STORAGE_KEY, all);
  }

  async clear(): Promise<void> {
    await this.storage.delete(STORAGE_KEY);
  }
}
