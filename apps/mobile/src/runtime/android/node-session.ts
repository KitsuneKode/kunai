import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Owner record inside `session.lock`. A plain mkdir lock never releases on
 * crash/ANR/SIGKILL — the directory survives and every later session threw
 * "requires lock recovery" forever. The owner lets a next boot decide: a live
 * recorded pid means a real concurrent session; a dead one is a crash remnant.
 */
const OWNER_FILE = "owner.json";

type LockOwner = {
  readonly pid: number;
  readonly startedAt: string | null;
  /** Legacy owner records have no generation; decoding materializes undefined. */
  readonly ownerId: string | undefined;
};

function hasErrorCode<T>(error: T, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

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
    // Only ESRCH proves absence; permissions and unexpected errors are uncertain.
    return !hasErrorCode(error, "ESRCH");
  }
  // The pid answers — but is it *our* recorded owner or a recycled slot?
  const recorded = owner.startedAt;
  if (recorded === null) return true; // No baseline recorded: trust the liveness answer.
  const current = processStartTicks(owner.pid);
  return current === null || current === recorded;
}

function isJsonString<T>(value: T): value is T & string {
  // Primitive boundary decoding must not invoke conversion hooks.
  // eslint-disable-next-line anti-slop/no-runtime-typeof
  return typeof value === "string";
}

function isJsonNumber<T>(value: T): value is T & number {
  return Number.isFinite(value);
}

function readOwner(path: string): LockOwner | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!(parsed instanceof Object) || Array.isArray(parsed))
      throw new Error("Invalid mobile session owner; explicit recovery required");
    // SAFETY: JSON produces plain data; every returned field is validated below.
    const { pid, startedAt, ownerId } = parsed as Partial<LockOwner>;
    if (
      !isJsonNumber(pid) ||
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      (startedAt !== null && (!isJsonString(startedAt) || !/^\d+$/.test(startedAt))) ||
      (ownerId !== undefined && (!isJsonString(ownerId) || !ownerId))
    )
      throw new Error("Invalid mobile session owner; explicit recovery required");
    return { pid, startedAt, ownerId };
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw new Error(
      "Mobile session ownership could not be verified; close all sessions before explicit recovery",
      { cause: error },
    );
  }
}

function publishRecord(path: string, value: LockOwner | number): void {
  const temporary = `${path}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Unique bakery tickets serialize reclaim, publication, and release. A caller
 * blocked by a live/choosing peer fails promptly, rather than sleeping in the
 * terminal's synchronous startup. Dead tickets are immutable paths, so deleting
 * one cannot erase a successor. These records are ephemeral, not user state.
 */
function withSessionTransition(root: string, fn: () => void): void {
  const ownerId = randomUUID();
  const prefix = "session.transition-";
  const ownName = `${prefix}${ownerId}.owner`;
  const path = join(root, ownName);
  const own: LockOwner = { pid: process.pid, startedAt: processStartTicks(process.pid), ownerId };
  publishRecord(path, own);
  const list = () => {
    const peers: Array<{ ownerId: string; ticket: number }> = [];
    for (const name of readdirSync(root)) {
      if (!name.startsWith(prefix) || !name.endsWith(".owner") || name === ownName) continue;
      const peerPath = join(root, name);
      const peer = readOwner(peerPath);
      if (!peer) continue;
      if (!ownerAlive(peer)) {
        rmSync(`${peerPath}.number`, { force: true });
        rmSync(peerPath, { force: true });
        continue;
      }
      if (!peer.ownerId || name !== `${prefix}${peer.ownerId}.owner`)
        throw new Error("Invalid mobile session transition; explicit recovery required");
      let ticket = 0;
      try {
        const value: unknown = JSON.parse(readFileSync(`${peerPath}.number`, "utf8"));
        if (!isJsonNumber(value) || !Number.isSafeInteger(value) || value <= 0)
          throw new Error("Invalid mobile session ticket; explicit recovery required");
        ticket = value;
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) throw error;
      }
      peers.push({ ownerId: peer.ownerId, ticket });
    }
    return peers;
  };
  try {
    const ticket = 1 + Math.max(0, ...list().map((peer) => peer.ticket));
    if (!Number.isSafeInteger(ticket)) throw new Error("Mobile session ticket overflow");
    publishRecord(`${path}.number`, ticket);
    if (
      list().some(
        (peer) =>
          peer.ticket === 0 ||
          peer.ticket < ticket ||
          (peer.ticket === ticket && peer.ownerId < ownerId),
      )
    )
      throw new Error("Mobile session transition is busy; retry after the other launch finishes");
    fn();
  } finally {
    rmSync(`${path}.number`, { force: true });
    rmSync(path, { force: true });
  }
}

/** True when the stale lock was removed and acquisition should be retried. */
function reclaimStaleLock(lock: string): boolean {
  const owner = readOwner(join(lock, OWNER_FILE));
  // Time alone cannot prove ownership, including for an ownerless crash remnant.
  if (!owner || ownerAlive(owner)) return false;
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
  const owner: LockOwner = {
    pid: process.pid,
    startedAt: processStartTicks(process.pid),
    ownerId: randomUUID(),
  };
  withSessionTransition(root, () => {
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      if (!reclaimStaleLock(lock)) {
        throw new Error("Mobile session is already active or requires lock recovery", {
          cause: error,
        });
      }
      mkdirSync(lock, { mode: 0o700 });
    }
    try {
      writeFileSync(join(lock, OWNER_FILE), JSON.stringify(owner), { mode: 0o600, flag: "wx" });
    } catch (error) {
      // Creation and cleanup are guarded; this path cannot belong to a successor.
      rmSync(lock, { recursive: true, force: true });
      throw error;
    }
  });
  let released = false;
  const release = () => {
    if (released) return;
    withSessionTransition(root, () => {
      if (readOwner(join(lock, OWNER_FILE))?.ownerId === owner.ownerId)
        rmSync(lock, { recursive: true, force: true });
    });
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
