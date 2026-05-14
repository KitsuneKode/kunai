import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";

const HISTORY_FILE = join(process.env.HOME ?? "~", ".config", "kunai", "search-history.json");
const MAX_HISTORY = 50;

let _cache: string[] | null = null;

function load(): string[] {
  if (_cache !== null) return _cache;
  try {
    const raw = readFileSync(HISTORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    _cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    _cache = [];
  }
  return _cache;
}

function persist(history: string[]): void {
  writeAtomicJson(HISTORY_FILE, history).catch(() => {
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
