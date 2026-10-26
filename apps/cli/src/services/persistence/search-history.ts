import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ShellMode } from "@/domain/types";
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

async function readHistory(file: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
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
  resolveFile: (mode?: ShellMode) => string = (mode) =>
    join(kunaiConfigDir(), mode ? `search-history-${mode}.json` : "search-history.json"),
) {
  const pending: { file: string; query: string }[] = [];
  let queue: Promise<void> = Promise.resolve();
  let lastAttempt: Promise<void> = queue;
  const snapshots = new Map<string, readonly string[]>();
  const refreshing = new Map<string, Promise<void>>();
  const revisions = new Map<string, number>();
  const listeners = new Set<() => void>();
  const publish = (file: string, history: readonly string[]) => {
    const prior = snapshots.get(file);
    if (prior?.length === history.length && prior.every((value, index) => value === history[index]))
      return;
    snapshots.delete(file);
    snapshots.set(file, history);
    // A running app uses one profile; bound snapshots across profile switches.
    if (snapshots.size > 4) {
      const oldest = snapshots.keys().next().value;
      if (oldest !== undefined) {
        snapshots.delete(oldest);
        revisions.delete(oldest);
      }
    }
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh(mode?: ShellMode): Promise<void> {
      const file = resolveFile(mode);
      const existing = refreshing.get(file);
      if (existing) return existing;
      const revision = revisions.get(file) ?? 0;
      const work = queue
        .then(async () => {
          let history: string[];
          try {
            history = await readHistory(file);
          } catch {
            history = [];
          } // A corrupt history cannot block search.
          // A refresh that raced an accepted local query must not replace its
          // durable snapshot with older bytes from before the write.
          if ((revisions.get(file) ?? 0) === revision) publish(file, history);
        })
        .finally(() => {
          refreshing.delete(file);
        });
      refreshing.set(file, work);
      return work;
    },
    get(mode?: ShellMode): readonly string[] {
      const file = resolveFile(mode);
      const disk = snapshots.get(file) ?? [];
      const local = pending
        .filter((entry) => entry.file === file)
        .map((entry) => entry.query)
        .reverse();
      return [...new Set([...local, ...disk])].slice(0, MAX_HISTORY);
    },
    add(query: string, mode?: ShellMode): void {
      const trimmed = query.trim();
      if (!trimmed) return;
      // Capture before the async queue yields: profile/environment changes can
      // never redirect an already accepted query into another profile.
      const entry = { file: resolveFile(mode), query: trimmed };
      pending.push(entry);
      revisions.set(entry.file, (revisions.get(entry.file) ?? 0) + 1);
      for (const listener of listeners) listener();
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
              const disk = await readHistory(entry.file);
              const merged = [...new Set([entry.query, ...disk])].slice(0, MAX_HISTORY);
              await writeAtomicJson(entry.file, merged);
              publish(entry.file, merged);
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
export const getSearchHistory = (mode?: ShellMode) => store.get(mode);
export const addSearchQuery = (query: string, mode?: ShellMode) => store.add(query, mode);
export const flushSearchHistory = () => store.flush();

export const refreshSearchHistory = (mode?: ShellMode) => store.refresh(mode);
export const subscribeSearchHistory = (listener: () => void) => store.subscribe(listener);
