import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";
import { errorCode } from "@/infra/fs/errno";
import {
  CONFIG_LOCK_ACQUIRE_TIMEOUT_MS,
  withConfigLockTransition,
} from "@/infra/storage/config-lock";
import { kunaiConfigDir } from "@/infra/storage/kunai-paths";
import { dbgErr } from "@/logger";
import { isJsonString } from "@kunai/types";

const MAX_HISTORY = 50;

function readHistory(file: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid search history data");
  }
  if (!Array.isArray(parsed) || !parsed.every(isJsonString)) {
    throw new Error("Invalid search history data");
  }
  return [...new Set(parsed)].slice(0, MAX_HISTORY);
}

/** One scoped writer; disk is authoritative across sessions and profiles. */
export function createSearchHistoryStore(
  resolveFile: () => string = () => join(kunaiConfigDir(), "search-history.json"),
) {
  const pending: { file: string; query: string }[] = [];
  let queue: Promise<void> = Promise.resolve();
  let lastAttempt: Promise<void> = queue;
  return {
    get(): readonly string[] {
      const file = resolveFile();
      let disk: string[];
      try {
        disk = readHistory(file);
      } catch {
        disk = [];
      } // Broken history must not prevent searching.
      const local = pending
        .filter((entry) => entry.file === file)
        .map((entry) => entry.query)
        .reverse();
      return [...new Set([...local, ...disk])].slice(0, MAX_HISTORY);
    },
    add(query: string): void {
      const trimmed = query.trim();
      if (!trimmed) return;
      // Capture before the async queue yields: profile/environment changes can
      // never redirect an already accepted query into another profile.
      const entry = { file: resolveFile(), query: trimmed };
      pending.push(entry);
      lastAttempt = queue
        .then(async () => {
          await mkdir(dirname(entry.file), { recursive: true });
          await withConfigLockTransition(
            `${entry.file}.lock`,
            Date.now() + CONFIG_LOCK_ACQUIRE_TIMEOUT_MS,
            {},
            async () => {
              // The lock owns the read AND replacement. A per-process promise
              // chain or atomic rename alone cannot preserve sibling appends.
              const disk = readHistory(entry.file);
              const merged = [...new Set([entry.query, ...disk])].slice(0, MAX_HISTORY);
              await writeAtomicJson(entry.file, merged);
            },
          );
        })
        .finally(() => {
          pending.splice(pending.indexOf(entry), 1);
        });
      queue = lastAttempt.catch((error) => {
        // Search remains usable; flush exposes failure to shutdown/tests.
        // Never log query text or the corrupt payload.
        dbgErr("SearchHistory", "persist failed", error);
      });
    },
    flush(): Promise<void> {
      return lastAttempt;
    },
  };
}

const store = createSearchHistoryStore();
export const getSearchHistory = () => store.get();
export const addSearchQuery = (query: string) => store.add(query);
export const flushSearchHistory = () => store.flush();
