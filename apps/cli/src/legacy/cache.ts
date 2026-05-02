import { existsSync } from "fs";
import { appendFile, readFile, writeFile } from "fs/promises";

import type { StreamData } from "@/scraper";

const CACHE_FILE = "stream_cache.json";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getCachedStream(url: string): Promise<StreamData | null> {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const cache = JSON.parse(await readFile(CACHE_FILE, "utf-8"));
    const entry = cache[url];
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry as StreamData;
  } catch {}
  return null;
}

// Persists a scraped stream to disk and appends to the human-readable log.
export async function cacheStream(targetUrl: string, data: StreamData): Promise<void> {
  let cache: Record<string, unknown> = {};
  if (existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(await readFile(CACHE_FILE, "utf-8"));
    } catch {}
  }
  cache[targetUrl] = data;
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8").catch(() => {});

  const logEntry =
    `\n=== ${new Date().toISOString()} ===\n` +
    `Target:   ${targetUrl}\n` +
    `Stream:   ${data.url}\n` +
    `Subtitle: ${data.subtitle ?? "None"}\n`;
  await appendFile("logs.txt", logEntry, "utf-8").catch(() => {});
}
