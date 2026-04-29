import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

export type HistoryEntry = {
  title: string;
  type: "movie" | "series";
  season: number;
  episode: number;
  timestamp: number; // seconds into the episode when user quit
  duration: number; // total episode duration in seconds
  completed?: boolean;
  provider: string;
  watchedAt: string; // ISO date
};

type HistoryFile = Record<string, HistoryEntry>;

const HISTORY_DIR = join(process.env.HOME ?? "~", ".local", "share", "kunai");
const HISTORY_FILE = join(HISTORY_DIR, "history.json");

function ensureDir() {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
}

async function load(): Promise<HistoryFile> {
  ensureDir();
  if (!existsSync(HISTORY_FILE)) return {};
  try {
    return JSON.parse(await readFile(HISTORY_FILE, "utf-8"));
  } catch {
    return {};
  }
}

async function save(data: HistoryFile): Promise<void> {
  ensureDir();
  await writeFile(HISTORY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function getHistory(tmdbId: string): Promise<HistoryEntry | null> {
  const data = await load();
  return data[tmdbId] ?? null;
}

export async function getAllHistory(): Promise<HistoryFile> {
  return load();
}

export async function saveHistory(tmdbId: string, entry: HistoryEntry): Promise<void> {
  const data = await load();
  data[tmdbId] = entry;
  await save(data);
}

export async function clearEntry(tmdbId: string): Promise<void> {
  const data = await load();
  delete data[tmdbId];
  await save(data);
}

export async function clearAllHistory(): Promise<void> {
  await save({});
}

// Returns true if the episode was essentially "finished" (watched >85%)
export function isFinished(entry: HistoryEntry): boolean {
  if (entry.completed) return true;
  if (!entry.duration) return false;
  return entry.timestamp / entry.duration > 0.85;
}

export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
