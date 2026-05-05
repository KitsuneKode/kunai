import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_DIR = join(process.env.HOME ?? "~", ".config", "kunai");
const HISTORY_FILE = join(CONFIG_DIR, "search-history.json");
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
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(HISTORY_FILE, JSON.stringify(history), "utf-8");
  } catch {
    // best-effort; don't break the session if the write fails
  }
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
