import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseCanonicalVersion } from "../version";
import { activationLockPath, type InstallLayoutPaths } from "./install-layout";
import {
  isProcessAlive,
  normalizedHostname,
  processStartId,
  type ProcessStartIdLookup,
} from "./lock-owner-identity";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 50;
const DEFAULT_CORRUPT_GRACE_MS = 250;
const PROCESS_START_ID_GRACE_MS = 1_000;

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
  /** Test seam for deterministic PID-reuse coverage. */
  readonly processStartIdLookup?: ProcessStartIdLookup;
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

const localAcquisitionTails = new Map<string, Promise<void>>();

async function serializeLocalAcquisition(
  path: string,
  deadlineAt: number,
  fn: () => Promise<ActivationLockAcquireResult>,
): Promise<ActivationLockAcquireResult> {
  const queued = localAcquisitionTails.get(path);
  const previous = queued ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  localAcquisitionTails.set(path, tail);
  const remainingMs = deadlineAt - Date.now();
  const ready = queued
    ? await Promise.race([
        previous.then(() => true),
        Bun.sleep(Math.max(0, remainingMs)).then(() => false),
      ])
    : true;
  if (!ready) {
    release();
    if (localAcquisitionTails.get(path) === tail) localAcquisitionTails.delete(path);
    return { acquired: false };
  }
  try {
    return await fn();
  } finally {
    release();
    if (localAcquisitionTails.get(path) === tail) localAcquisitionTails.delete(path);
  }
}

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

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

function ownerState(
  content: ActivationLockContent,
  processProbeBudgetMs: number = Number.POSITIVE_INFINITY,
  processStartIdLookup: ProcessStartIdLookup = processStartId,
): OwnerState {
  if (content.hostname.trim().toLowerCase() !== normalizedHostname()) return "foreign-host";
  if (!isProcessAlive(content.pid)) return "stale";
  const acquiredAtMs = Date.parse(content.acquiredAt);
  const startIdentityDue =
    !Number.isFinite(acquiredAtMs) || Date.now() - acquiredAtMs >= PROCESS_START_ID_GRACE_MS;
  if (content.processStartId && startIdentityDue) {
    const currentStartId = processStartIdLookup(content.pid, processProbeBudgetMs);
    if (currentStartId && currentStartId !== content.processStartId) return "stale";
  }
  return "active";
}

async function reclaimClaimOwnerState(
  path: string,
  content: ActivationLockContent,
  processProbeBudgetMs: number = Number.POSITIVE_INFINITY,
  processStartIdLookup: ProcessStartIdLookup = processStartId,
): Promise<OwnerState> {
  if (content.hostname.trim().toLowerCase() !== normalizedHostname()) return "foreign-host";
  if (!isProcessAlive(content.pid)) return "stale";

  // A reclaim claim is normally present for only a few file operations. Avoid
  // launching an expensive Windows process-start probe for every contender's
  // fresh claim; that creates an O(contenders²) PowerShell storm. Dead PIDs are
  // still reclaimed immediately, while an aged live-PID claim receives the
  // full PID-reuse check before it can block future attempts indefinitely.
  const claimStat = await stat(path).catch(() => null);
  if (!claimStat || Date.now() - claimStat.mtimeMs < PROCESS_START_ID_GRACE_MS) {
    return "active";
  }
  if (content.processStartId) {
    const currentStartId = processStartIdLookup(content.pid, processProbeBudgetMs);
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
  successorRaw: string,
  deadlineAt: number,
  processStartIdLookup: ProcessStartIdLookup,
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
    ? ownerState(
        quarantined.content,
        Math.max(0, deadlineAt - Date.now()),
        processStartIdLookup,
      ) === "stale"
    : quarantined.raw !== null;
  if (!unchanged || !stillReclaimable) {
    await restoreQuarantinedLock(quarantinePath, path);
    return false;
  }

  try {
    await rm(quarantinePath, { force: true });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (Date.now() >= deadlineAt) return false;
      try {
        await writeFile(path, successorRaw, { flag: "wx", mode: 0o600 });
        return true;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        await Bun.sleep(Math.min(1, Math.max(0, deadlineAt - Date.now())));
      }
    }
    return false;
  } catch (error) {
    try {
      await restoreQuarantinedLock(quarantinePath, path);
    } catch (restoreError) {
      throw new Error(`Could not restore quarantined activation lock at ${path}`, {
        cause: restoreError,
      });
    }
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

function reclaimClaimPrefix(path: string): string {
  return `${path}.reclaim.`;
}

function reclaimClaimTempPrefix(path: string): string {
  return `${path}.reclaim-tmp.`;
}

async function listReclaimClaims(
  path: string,
  deadlineAt: number = Number.POSITIVE_INFINITY,
  processStartIdLookup: ProcessStartIdLookup = processStartId,
): Promise<string[]> {
  const prefix = reclaimClaimPrefix(path);
  const tempPrefix = reclaimClaimTempPrefix(path);
  const names = await readdir(dirname(path)).catch(() => [] as string[]);
  const claims: string[] = [];
  for (const name of names) {
    const claimPath = join(dirname(path), name);
    const isLegacyTemp =
      claimPath.startsWith(prefix) && claimPath.slice(prefix.length).includes(".tmp.");
    if (claimPath.startsWith(tempPrefix) || isLegacyTemp) {
      // Temp records never participate in election. Old releases wrote them
      // below `.reclaim.*`; a crash during that write otherwise left an
      // invalid, permanently blocking claim. Preserve live/fresh writers, but
      // clean dead-owner records and invalid residue after corrupt grace.
      const temp = await readActivationLock(claimPath);
      const tempStat = await stat(claimPath).catch(() => null);
      const reclaimable = temp.content
        ? (await reclaimClaimOwnerState(
            claimPath,
            temp.content,
            Math.max(0, deadlineAt - Date.now()),
            processStartIdLookup,
          )) === "stale"
        : tempStat !== null && Date.now() - tempStat.mtimeMs >= DEFAULT_CORRUPT_GRACE_MS;
      if (reclaimable) await rm(claimPath, { force: true }).catch(() => {});
      continue;
    }
    if (!claimPath.startsWith(prefix)) continue;
    const claim = await readActivationLock(claimPath);
    if (
      claim.content &&
      (await reclaimClaimOwnerState(
        claimPath,
        claim.content,
        Math.max(0, deadlineAt - Date.now()),
        processStartIdLookup,
      )) === "stale"
    ) {
      // Claim paths include a UUID and are never reused, so deleting a dead
      // claimant cannot remove a successor's claim.
      await rm(claimPath, { force: true }).catch(() => {});
      continue;
    }
    claims.push(claimPath);
  }
  return claims.sort();
}

async function createReclaimClaim(path: string, ownerId: string, raw: string): Promise<string> {
  const claimPath = `${reclaimClaimPrefix(path)}${ownerId}`;
  const tempPath = `${reclaimClaimTempPrefix(path)}${ownerId}.${randomUUID()}`;
  await writeFile(tempPath, raw, { flag: "wx", mode: 0o600 });
  try {
    await rename(tempPath, claimPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  return claimPath;
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
  const deadlineAt = Date.now() + timeoutMs;
  return serializeLocalAcquisition(path, deadlineAt, () =>
    tryAcquireActivationLockFromFilesystem(path, canonical, options, deadlineAt),
  );
}

async function tryAcquireActivationLockFromFilesystem(
  path: string,
  canonical: string,
  options: ActivationLockOptions,
  deadlineAt: number,
): Promise<ActivationLockAcquireResult> {
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_POLL_MS);
  const corruptGraceMs = Math.max(0, options.corruptGraceMs ?? DEFAULT_CORRUPT_GRACE_MS);
  const processStartIdLookup = options.processStartIdLookup ?? processStartId;
  const ownerId = `${process.pid}-${randomUUID()}`;
  // Resolve this once before timestamping the record. On Windows the fallback
  // PowerShell query is comparatively expensive; acquisition-age grace starts
  // when the lock is ready to publish, not while that identity is being read.
  const ownProcessStartId = processStartIdLookup(process.pid, Math.max(1, deadlineAt - Date.now()));
  const content: ActivationLockContent = {
    schemaVersion: 1,
    scope: "activation",
    pid: process.pid,
    version: canonical,
    execPath: options.execPath ?? process.execPath,
    ownerId,
    acquiredAt: new Date().toISOString(),
    hostname: normalizedHostname(),
    processStartId: ownProcessStartId,
  };
  const contentRaw = `${JSON.stringify(content)}\n`;
  let corruptRaw: string | null = null;
  let corruptSince = 0;
  let holderPid: number | undefined;
  let attempted = false;

  await mkdir(dirname(path), { recursive: true });

  const acquiredResult = (): ActivationLockAcquireResult => ({
    acquired: true,
    release: async () => {
      const current = await readActivationLock(path);
      if (current.content?.ownerId === ownerId) {
        // Rename first, then validate the moved inode. A read-then-delete
        // release could otherwise remove a successor created in between.
        try {
          await quarantineForRelease(path, ownerId);
        } catch (error) {
          throw new Error(`Could not release activation lock at ${path}`, { cause: error });
        }
      }
    },
  });

  const reclaimObserved = async (observed: LockRead, allowCorrupt: boolean): Promise<boolean> => {
    const claimPath = await createReclaimClaim(path, ownerId, contentRaw);
    try {
      const claims = await listReclaimClaims(path, deadlineAt, processStartIdLookup);
      if (claims[0] !== claimPath) return false;
      const current = await readActivationLock(path);
      if (current.raw !== observed.raw) return false;
      if (current.content) {
        if (
          ownerState(
            current.content,
            Math.max(0, deadlineAt - Date.now()),
            processStartIdLookup,
          ) !== "stale"
        ) {
          return false;
        }
      } else if (!allowCorrupt || current.raw === null) {
        return false;
      }
      return await quarantineForReclaim(
        path,
        current,
        ownerId,
        contentRaw,
        deadlineAt,
        processStartIdLookup,
      );
    } finally {
      await rm(claimPath, { force: true }).catch(() => {});
    }
  };

  const sleepForRetry = async (): Promise<boolean> => {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return false;
    await Bun.sleep(Math.min(pollMs, remainingMs));
    return Date.now() < deadlineAt;
  };

  while (true) {
    if (attempted && Date.now() >= deadlineAt) {
      return holderPid === undefined ? { acquired: false } : { acquired: false, holderPid };
    }
    attempted = true;
    if ((await listReclaimClaims(path, deadlineAt, processStartIdLookup)).length > 0) {
      if (!(await sleepForRetry())) return { acquired: false, holderPid };
      continue;
    }
    try {
      await writeFile(path, contentRaw, { flag: "wx", mode: 0o600 });
      if ((await listReclaimClaims(path, deadlineAt, processStartIdLookup)).length === 0) {
        return acquiredResult();
      }
      await quarantineForRelease(path, ownerId);
      continue;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw new Error(`Could not create activation lock at ${path}`, { cause: error });
      }
      // Another owner won exclusive creation. Inspect before deciding whether
      // it is live, dead, or a partially-written/corrupt record.
    }

    const observed = await readActivationLock(path);
    if (observed.raw === null) {
      if (!(await sleepForRetry())) return { acquired: false };
      continue;
    }

    if (observed.content) {
      corruptRaw = null;
      corruptSince = 0;
      holderPid = observed.content.pid;
      if (
        ownerState(observed.content, Math.max(0, deadlineAt - Date.now()), processStartIdLookup) ===
        "stale"
      ) {
        if (await reclaimObserved(observed, false)) return acquiredResult();
      }
    } else if (observed.raw !== corruptRaw) {
      corruptRaw = observed.raw;
      corruptSince = Date.now();
      holderPid = undefined;
    } else if (Date.now() - corruptSince >= corruptGraceMs) {
      if (await reclaimObserved(observed, true)) return acquiredResult();
      corruptRaw = null;
      corruptSince = 0;
    }

    if (!(await sleepForRetry())) {
      return holderPid === undefined ? { acquired: false } : { acquired: false, holderPid };
    }
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
