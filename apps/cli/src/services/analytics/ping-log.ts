/**
 * The local record behind `kunai analytics log`: the last pings, byte for byte.
 *
 * Saying what a ping contains is a claim. This file lets a user check it: each
 * entry holds the exact request body that left, so what `kunai analytics log`
 * prints is what was sent, not a description of it.
 *
 * It exists only while analytics is enabled. The send path appends to it after
 * every gate has passed, and every way out (disable, an env block, a sibling's
 * disable seen at the next start) removes it. It is owner-only (`0o600`)
 * because it is nobody else's business, though it holds nothing the endpoint
 * did not already receive.
 */

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomicSecretJson } from "@/infra/fs/atomic-write";
import { getKunaiPaths } from "@kunai/storage";

/** How many pings `kunai analytics log` can show. Older entries are dropped. */
export const PING_LOG_LIMIT = 50;

export const PING_LOG_FILE_NAME = "analytics-pings.json";

export type PingLogEntry = {
  /** When the request left, ISO 8601. Local only; never sent. */
  readonly sentAt: string;
  readonly endpoint: string;
  /** The request body exactly as sent. */
  readonly body: string;
};

export interface PingLog {
  append(entry: PingLogEntry): Promise<void>;
  /** Oldest first. A missing or unreadable file reads as empty. */
  read(): Promise<readonly PingLogEntry[]>;
  remove(): Promise<void>;
}

type PingLogDocument = { readonly schemaVersion: 1; readonly pings: readonly PingLogEntry[] };

/** Lives in the OS data dir beside `kunai-data.sqlite`. */
export function pingLogPath(dataDir: string = getKunaiPaths().dataDir): string {
  return join(dataDir, PING_LOG_FILE_NAME);
}

export function filePingLog(path: string): PingLog {
  const read = async (): Promise<readonly PingLogEntry[]> => {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as Partial<PingLogDocument> | null;
      return Array.isArray(parsed?.pings) ? parsed.pings.filter(isPingLogEntry) : [];
    } catch {
      return [];
    }
  };
  return {
    read,
    async append(entry) {
      const pings = [...(await read()), entry].slice(-PING_LOG_LIMIT);
      const document: PingLogDocument = { schemaVersion: 1, pings };
      await writeAtomicSecretJson(path, document);
    },
    async remove() {
      await rm(path, { force: true });
    },
  };
}

function isPingLogEntry(value: unknown): value is PingLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.sentAt === "string" &&
    typeof entry.endpoint === "string" &&
    typeof entry.body === "string"
  );
}
