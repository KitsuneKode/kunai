import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Owner record inside `session.lock`. A plain mkdir lock never releases on
 * crash/ANR/SIGKILL — the directory survives and every later session threw
 * "requires lock recovery" forever. The owner lets a next boot decide: a live
 * recorded pid means a real concurrent session; a dead one is a crash remnant.
 */
const OWNER_FILE = "owner.json";

/**
 * `mkdir` and the owner write are adjacent synchronous calls, so an ownerless
 * lock dir is either mid-acquisition (grace window) or a crash inside it.
 * Reclaiming any ownerless dir would race a peer that is about to write its
 * record — the bound keeps that impossible-ish window honest.
 */
const OWNER_WRITE_GRACE_MS = 30_000;

type LockOwner = {
  readonly pid: number;
  readonly startedAt: string | null;
};

/** `/proc/<pid>/stat` start ticks — disambiguates a recycled pid. null off-Linux. */
function processStartTicks(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return (
      stat
        .slice(stat.lastIndexOf(") ") + 2)
        .trim()
        .split(/\s+/)[19] ?? null
    );
  } catch {
    return null;
  }
}

function ownerAlive(owner: LockOwner): boolean {
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    // SAFETY: a kill(2) failure carries the errno on `.code` — this is the
    // same ErrnoException shape the CLI's lock-owner-identity probe relies on.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  // The pid answers — but is it *our* recorded owner or a recycled slot?
  const recorded = owner.startedAt;
  if (recorded === null) return true; // No baseline recorded: trust the liveness answer.
  const current = processStartTicks(owner.pid);
  return current === null || current === recorded;
}

// Mobile has no package dependencies, so the owner record is decoded with the
// same boxing-comparison guards `packages/types/src/json-value.ts` uses.
function isJsonString<T>(value: T): value is T & string {
  return String(value) === value;
}

function isJsonNumber<T>(value: T): value is T & number {
  return Object.prototype.toString.call(value) === "[object Number]" && !(value instanceof Object);
}

function readOwner(lock: string): LockOwner | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(lock, OWNER_FILE), "utf8"));
    if (!(parsed instanceof Object) || Array.isArray(parsed)) return null;
    // SAFETY: the instanceof above establishes a plain object; the field
    // guards below validate each slot before it is read.
    const { pid, startedAt } = parsed as Partial<LockOwner>;
    if (!isJsonNumber(pid)) return null;
    return { pid, startedAt: isJsonString(startedAt) ? startedAt : null };
  } catch {
    return null;
  }
}

/** True when the stale lock was removed and acquisition should be retried. */
function reclaimStaleLock(lock: string): boolean {
  const owner = readOwner(lock);
  if (owner ? ownerAlive(owner) : false) return false;
  if (!owner) {
    // Ownerless: inside the grace window a peer may still be writing.
    try {
      if (Date.now() - statSync(lock).mtimeMs < OWNER_WRITE_GRACE_MS) return false;
    } catch {
      return false;
    }
  }
  try {
    rmSync(lock, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Own the complete load/prompt/commit session, not just individual writes. */
export function acquireNodeSession(root: string, onInterrupt?: () => void): () => void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const lock = join(root, "session.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    if (!reclaimStaleLock(lock)) {
      throw new Error("Mobile session is already active or requires lock recovery");
    }
    mkdirSync(lock, { mode: 0o700 });
  }
  writeFileSync(
    join(lock, OWNER_FILE),
    JSON.stringify({ pid: process.pid, startedAt: processStartTicks(process.pid) }),
    { mode: 0o600 },
  );
  let released = false;
  const release = () => {
    if (released) return;
    rmSync(lock, { recursive: true, force: true });
    released = true;
    process.off("exit", onExit);
    if (onInterrupt) process.off("SIGINT", onInterrupt);
  };
  const onExit = () => {
    try {
      release();
    } catch {
      // Retain an uncertain lock for operator recovery rather than stealing ownership.
    }
  };
  process.once("exit", onExit);
  if (onInterrupt) process.on("SIGINT", onInterrupt);
  return release;
}
