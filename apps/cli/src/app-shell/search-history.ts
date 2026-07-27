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

function load(): string[] {
  if (_cache !== null) return _cache;
  try {
    const raw = readFileSync(historyFile(), "utf-8");
    const parsed = JSON.parse(raw);
    _cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    _cache = [];
  }
  return _cache;
}

function persist(history: string[]): void {
  writeAtomicJson(historyFile(), history).catch(() => {
    // best-effort; don't break the session if the write fails
  });
}

export function getSearchHistory(): readonly string[] {
  return load();
}

export function addSearchQuery(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  const current = load();
  const deduped = [trimmed, ...current.filter((q) => q !== trimmed)].slice(0, MAX_HISTORY);
  _cache = deduped;
  persist(deduped);
}
