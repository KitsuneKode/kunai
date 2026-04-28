// =============================================================================
// History Store
//
// Manages watch history and playback positions.
// =============================================================================

import type { ContentType } from "../../domain/types";

export interface HistoryEntry {
  title: string;
  type: ContentType;
  season: number;
  episode: number;
  timestamp: number; // seconds
  duration: number;
  provider: string;
  watchedAt: string;
}

export interface HistoryStore {
  get(id: string): Promise<HistoryEntry | null>;
  getAll(): Promise<Record<string, HistoryEntry>>;
  save(id: string, entry: HistoryEntry): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

// Utility functions
export function isFinished(entry: HistoryEntry, threshold = 0.9): boolean {
  return entry.duration > 0 && entry.timestamp / entry.duration >= threshold;
}

export function formatTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
