import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";
import { kunaiConfigDir } from "@/infra/storage/kunai-paths";

/**
 * Search history lives beside the rest of Kunai's config, wherever the platform
 * puts that — `~/.config/kunai` on Linux, `%APPDATA%\kunai` on Windows,
 * `~/Library/Application Support/kunai` on macOS.
 *
 * This used to hand-roll `join(process.env.HOME ?? "~", ".config", "kunai")`,
 * which was wrong twice over off Linux. `.config` is a freedesktop convention
 * that Windows and macOS do not use, and `HOME` is normally unset on Windows
 * (the variable there is `USERPROFILE`) — so the fallback resolved to the
 * *literal* string "~" and history was written to a `./~/.config/kunai/`
 * directory created relative to the current working directory, which moved with
 * the shell and was invisible to every other part of Kunai.
 *
 * Resolved lazily: the path reads the environment, and computing it at module
 * load would bake in whatever was set at import time.
 */
function historyFile(): string {
  return join(kunaiConfigDir(), "search-history.json");
}

const MAX_HISTORY = 50;

let _cache: string[] | null = null;
let pendingWrite: Promise<void> = Promise.resolve();

function load(): string[] {
  if (_cache !== null) return _cache;
  _cache = readHistoryFile();
  return _cache;
}

function readHistoryFile(): string[] {
  try {
    const raw = readFileSync(historyFile(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function persist(history: string[]): void {
  // Serialize writes: rapid successive adds must land in call order, not
  // finish order — otherwise the last write to finish (not the last query)
  // wins the file.
  pendingWrite = pendingWrite
    .then(() => writeAtomicJson(historyFile(), history))
    .catch(() => {
      // best-effort; don't break the session if the write fails
    });
}

/** Test seam — the cache is module state and must not leak between cases. */
export function clearSearchHistoryCacheForTest(): void {
  _cache = null;
}

/** Test seam — await the fire-and-forget persist instead of sleeping. */
export function flushSearchHistoryForTest(): Promise<void> {
  return pendingWrite;
}

export function getSearchHistory(): readonly string[] {
  return [...load()];
}

export function addSearchQuery(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  // Merge the in-memory cache over a fresh disk read. The cache carries this
  // session's writes that may not have flushed yet (persist is fire-and-forget);
  // the disk read carries other sessions' appends. Either source alone loses
  // writes — together, last-write-wins only reorders.
  const seen = new Set([trimmed]);
  const merged = [trimmed];
  for (const q of [...load(), ...readHistoryFile()]) {
    if (seen.has(q)) continue;
    seen.add(q);
    merged.push(q);
  }
  _cache = merged.slice(0, MAX_HISTORY);
  persist(_cache);
}
