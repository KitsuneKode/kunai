// =============================================================================
// History Store
//
// Thin facade over HistoryRepository. Every method returns the canonical
// HistoryProgress row; the lossy HistoryEntry projection is retired.
// `isFinished`/`formatTimestamp` are re-exported from the history-progress
// authority so existing import sites keep resolving.
// =============================================================================

import type { HistoryProgress } from "@kunai/storage";

export { isFinished, formatTimestamp } from "../continuation/history-progress";

export interface HistoryStore {
  get(id: string): Promise<HistoryProgress | null>;
  getAll(): Promise<Record<string, HistoryProgress>>;
  listRecent(limit?: number): Promise<readonly [string, HistoryProgress][]>;
  listByTitle(id: string): Promise<readonly HistoryProgress[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}
