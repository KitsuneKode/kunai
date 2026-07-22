import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, rmdir } from "node:fs/promises";

import { writeAtomicJson } from "@/infra/fs/atomic-write";

import {
  isInsideStagingRoot,
  removeStagingAndPruneParents,
  transactionFilePath,
  type InstallLayoutPaths,
} from "./install-layout";

export interface InstallTransactionRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly kind: "install" | "upgrade" | "rollback" | "uninstall";
  readonly pid: number;
  readonly version?: string;
  readonly stagingDir?: string;
  readonly startedAt: string;
}

export type BeginInstallTransactionInput = {
  readonly kind: InstallTransactionRecord["kind"];
  readonly version?: string;
  readonly stagingDir?: string;
  readonly startedAt?: string;
  readonly pid?: number;
  readonly id?: string;
};

export type InstallTransactionInspection =
  | { readonly status: "missing" }
  | { readonly status: "present"; readonly record: InstallTransactionRecord }
  | { readonly status: "invalid"; readonly detail: string };

const KINDS = new Set(["install", "upgrade", "rollback", "uninstall"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseRecord(raw: unknown): InstallTransactionRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (typeof value.kind !== "string" || !KINDS.has(value.kind)) return null;
  if (typeof value.pid !== "number" || !Number.isInteger(value.pid)) return null;
  if (!isNonEmptyString(value.startedAt) || Number.isNaN(Date.parse(value.startedAt))) {
    return null;
  }
  if (value.version !== undefined && !isNonEmptyString(value.version)) return null;
  if (value.stagingDir !== undefined && !isNonEmptyString(value.stagingDir)) return null;

  return {
    schemaVersion: 1,
    id: value.id,
    kind: value.kind as InstallTransactionRecord["kind"],
    pid: value.pid,
    ...(value.version !== undefined ? { version: value.version } : {}),
    ...(value.stagingDir !== undefined ? { stagingDir: value.stagingDir } : {}),
    startedAt: value.startedAt,
  };
}

function newTransactionId(): string {
  return `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
}

export async function beginInstallTransaction(
  layout: Pick<InstallLayoutPaths, "transactionsDir">,
  input: BeginInstallTransactionInput,
): Promise<InstallTransactionRecord> {
  await mkdir(layout.transactionsDir, { recursive: true });
  const record: InstallTransactionRecord = {
    schemaVersion: 1,
    id: input.id ?? newTransactionId(),
    kind: input.kind,
    pid: input.pid ?? process.pid,
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.stagingDir !== undefined ? { stagingDir: input.stagingDir } : {}),
    startedAt: input.startedAt ?? new Date().toISOString(),
  };
  await writeAtomicJson(transactionFilePath(layout, record.id), record);
  return record;
}

export async function finishInstallTransaction(
  layout: Pick<InstallLayoutPaths, "transactionsDir">,
  id: string,
): Promise<void> {
  await rm(transactionFilePath(layout, id), { force: true }).catch(() => {});
}

export async function inspectInstallTransaction(
  layout: Pick<InstallLayoutPaths, "transactionsDir">,
  id: string,
): Promise<InstallTransactionInspection> {
  const path = transactionFilePath(layout, id);
  if (!existsSync(path)) return { status: "missing" };
  try {
    const record = parseRecord(JSON.parse(await readFile(path, "utf8")));
    if (!record) {
      return { status: "invalid", detail: "Transaction failed schema validation" };
    }
    return { status: "present", record };
  } catch {
    return { status: "invalid", detail: "Transaction is not valid JSON" };
  }
}

export async function listInstallTransactions(
  layout: Pick<InstallLayoutPaths, "transactionsDir">,
): Promise<readonly InstallTransactionRecord[]> {
  if (!existsSync(layout.transactionsDir)) return [];
  const entries = await readdir(layout.transactionsDir).catch(() => [] as string[]);
  const records: InstallTransactionRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -".json".length);
    const inspection = await inspectInstallTransaction(layout, id);
    if (inspection.status === "present") records.push(inspection.record);
  }
  return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Remove transaction records whose owning PID is no longer alive. */
export async function cleanupAbandonedTransactions(
  layout: Pick<InstallLayoutPaths, "transactionsDir" | "stagingRoot">,
): Promise<number> {
  if (!existsSync(layout.transactionsDir)) return 0;
  let cleaned = 0;
  for (const record of await listInstallTransactions(layout)) {
    if (isProcessAlive(record.pid)) continue;
    // Only reclaim staging paths that genuinely live under our staging root — a
    // record carrying a path from elsewhere must never trigger a recursive rm.
    if (record.stagingDir && isInsideStagingRoot(record.stagingDir, layout.stagingRoot)) {
      await removeStagingAndPruneParents(record.stagingDir, layout.stagingRoot);
    }
    await finishInstallTransaction(layout, record.id);
    cleaned += 1;
  }
  await rmdir(layout.transactionsDir).catch(() => {});
  return cleaned;
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
