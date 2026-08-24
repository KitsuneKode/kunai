import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname as getHostname } from "node:os";

import { parseCanonicalVersion } from "../version";
import { activationLockPath, type InstallLayoutPaths } from "./install-layout";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 50;
const DEFAULT_CORRUPT_GRACE_MS = 250;

export type ActivationLockContent = {
  readonly schemaVersion: 1;
  readonly scope: "activation";
  readonly pid: number;
  readonly version: string;
  readonly execPath: string;
  readonly ownerId: string;
  readonly acquiredAt: string;
  readonly hostname: string;
  readonly processStartId: string | null;
};

export type ActivationLockAcquireResult =
  | { readonly acquired: true; readonly release: () => Promise<void> }
  | { readonly acquired: false; readonly holderPid?: number };

export type ActivationLockOptions = {
  readonly execPath?: string;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly corruptGraceMs?: number;
};

export type ActivationLockInspection =
  | { readonly status: "missing" }
  | { readonly status: "active"; readonly content: ActivationLockContent }
  | {
      readonly status: "stale";
      readonly content: ActivationLockContent | null;
      readonly reason: "dead-owner" | "invalid-metadata";
    };

type LockRead = {
  readonly content: ActivationLockContent | null;
  readonly raw: string | null;
};

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function localHostname(): string {
  return getHostname().trim().toLowerCase();
}

function processStartId(pid: number): string | null {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const afterName = stat
        .slice(stat.lastIndexOf(") ") + 2)
        .trim()
        .split(/\s+/);
      const startTicks = afterName[19];
      return startTicks ? `linux-proc:${startTicks}` : null;
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin") {
    try {
      const result = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)]);
      if (result.exitCode !== 0) return null;
      const value = result.stdout.toString().trim().replace(/\s+/g, " ");
      return value ? `darwin-ps:${value}` : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseLockContent(raw: string): ActivationLockContent | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.schemaVersion !== 1 ||
      value.scope !== "activation" ||
      !Number.isSafeInteger(value.pid) ||
      (value.pid as number) <= 0 ||
      typeof value.version !== "string" ||
      !parseCanonicalVersion(value.version) ||
      typeof value.execPath !== "string" ||
      !value.execPath ||
      typeof value.ownerId !== "string" ||
      !value.ownerId ||
      typeof value.acquiredAt !== "string" ||
      !ISO_UTC_PATTERN.test(value.acquiredAt) ||
      typeof value.hostname !== "string" ||
      !value.hostname.trim() ||
      (value.processStartId !== null &&
        (typeof value.processStartId !== "string" || !value.processStartId))
    ) {
      return null;
    }
    return value as ActivationLockContent;
  } catch {
    return null;
  }
}

type OwnerState = "active" | "stale" | "foreign-host";

function ownerState(content: ActivationLockContent): OwnerState {
  if (content.hostname.trim().toLowerCase() !== localHostname()) return "foreign-host";
  if (!isProcessAlive(content.pid)) return "stale";
  if (content.processStartId) {
    const currentStartId = processStartId(content.pid);
    if (currentStartId && currentStartId !== content.processStartId) return "stale";
  }
  return "active";
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

async function restoreQuarantinedLock(quarantinePath: string, lockPath: string): Promise<void> {
  try {
    // A hard link restores only when the canonical path is still absent. It
    // cannot overwrite an owner that acquired after the quarantine rename.
    await link(quarantinePath, lockPath);
    await rm(quarantinePath, { force: true });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    // A new canonical owner won. Keep the quarantine for diagnostics rather
    // than ever replacing or deleting that owner.
  }
}

async function quarantineForReclaim(
  path: string,
  observed: LockRead,
  ownerId: string,
): Promise<boolean> {
  const quarantinePath = `${path}.quarantine.${ownerId}.${randomUUID()}`;
  try {
    await rename(path, quarantinePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }

  const quarantined = await readActivationLock(quarantinePath);
  const unchanged = quarantined.raw === observed.raw;
  const stillReclaimable = quarantined.content
    ? ownerState(quarantined.content) === "stale"
    : quarantined.raw !== null;
  if (!unchanged || !stillReclaimable) {
    await restoreQuarantinedLock(quarantinePath, path);
    return false;
  }

  try {
    await rm(quarantinePath, { force: true });
    return true;
  } catch (error) {
    await restoreQuarantinedLock(quarantinePath, path).catch(() => {});
    throw error;
  }
}

async function readActivationLock(path: string): Promise<LockRead> {
  if (!existsSync(path)) return { content: null, raw: null };
  try {
    const raw = await readFile(path, "utf8");
    return { content: parseLockContent(raw), raw };
  } catch {
    return { content: null, raw: "" };
  }
}

/** Inspect activation ownership without mutating or reclaiming the lock. */
export async function inspectActivationLock(
  layout: Pick<InstallLayoutPaths, "locksDir">,
): Promise<ActivationLockInspection> {
  const observed = await readActivationLock(activationLockPath(layout));
  if (observed.raw === null) return { status: "missing" };
  if (!observed.content) {
    return { status: "stale", content: null, reason: "invalid-metadata" };
  }
  if (ownerState(observed.content) === "stale") {
    return { status: "stale", content: observed.content, reason: "dead-owner" };
  }
  return { status: "active", content: observed.content };
}

/**
 * Acquire the cross-language launcher/manifest activation lock.
 *
 * Bash, PowerShell, and TypeScript all use exclusive file creation at the same
 * path and the same JSON record. A short corrupt grace period prevents another
 * contender from reclaiming the file while its owner is still writing it.
 */
export async function tryAcquireActivationLock(
  layout: Pick<InstallLayoutPaths, "locksDir">,
  version: string,
  options: ActivationLockOptions = {},
): Promise<ActivationLockAcquireResult> {
  const canonical = parseCanonicalVersion(version);
  if (!canonical) throw new Error(`Invalid activation lock version: ${version}`);

  const path = activationLockPath(layout);
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_POLL_MS);
  const corruptGraceMs = Math.max(0, options.corruptGraceMs ?? DEFAULT_CORRUPT_GRACE_MS);
  const ownerId = `${process.pid}-${randomUUID()}`;
  const content: ActivationLockContent = {
    schemaVersion: 1,
    scope: "activation",
    pid: process.pid,
    version: canonical,
    execPath: options.execPath ?? process.execPath,
    ownerId,
    acquiredAt: new Date().toISOString(),
    hostname: localHostname(),
    processStartId: processStartId(process.pid),
  };
  const startedAt = Date.now();
  let corruptRaw: string | null = null;
  let corruptSince = 0;
  let holderPid: number | undefined;

  await mkdir(layout.locksDir, { recursive: true });

  while (true) {
    try {
      await writeFile(path, `${JSON.stringify(content)}\n`, { flag: "wx", mode: 0o600 });
      return {
        acquired: true,
        release: async () => {
          const current = await readActivationLock(path);
          if (current.content?.ownerId === ownerId) {
            // Rename first, then validate the moved inode. A read-then-delete
            // release could otherwise remove a successor created in between.
            await quarantineForRelease(path, ownerId).catch(() => {});
          }
        },
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw new Error(`Could not create activation lock at ${path}`, { cause: error });
      }
      // Another owner won exclusive creation. Inspect before deciding whether
      // it is live, dead, or a partially-written/corrupt record.
    }

    const observed = await readActivationLock(path);
    if (observed.raw === null) {
      if (Date.now() - startedAt >= timeoutMs) return { acquired: false };
      await Bun.sleep(Math.min(pollMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
      continue;
    }

    if (observed.content) {
      corruptRaw = null;
      corruptSince = 0;
      holderPid = observed.content.pid;
      if (ownerState(observed.content) === "stale") {
        await quarantineForReclaim(path, observed, ownerId);
        continue;
      }
    } else if (observed.raw !== corruptRaw) {
      corruptRaw = observed.raw;
      corruptSince = Date.now();
      holderPid = undefined;
    } else if (Date.now() - corruptSince >= corruptGraceMs) {
      await quarantineForReclaim(path, observed, ownerId);
      corruptRaw = null;
      corruptSince = 0;
      continue;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      return holderPid === undefined ? { acquired: false } : { acquired: false, holderPid };
    }
    await Bun.sleep(Math.min(pollMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
  }
}

async function quarantineForRelease(path: string, ownerId: string): Promise<void> {
  const quarantinePath = `${path}.quarantine.${ownerId}.${randomUUID()}`;
  try {
    await rename(path, quarantinePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  const moved = await readActivationLock(quarantinePath);
  if (moved.content?.ownerId === ownerId) {
    await rm(quarantinePath, { force: true });
    return;
  }
  await restoreQuarantinedLock(quarantinePath, path);
}

export async function withActivationLock<T>(
  layout: Pick<InstallLayoutPaths, "locksDir">,
  version: string,
  fn: () => Promise<T>,
  options: ActivationLockOptions = {},
): Promise<T | null> {
  const lock = await tryAcquireActivationLock(layout, version, options);
  if (!lock.acquired) return null;
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
