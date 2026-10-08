import { randomUUID } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";

import { writeAtomicEphemeralJson } from "@/infra/fs/atomic-write";
import { errorCode } from "@/infra/fs/errno";
import { isJsonObject, isJsonNumber, isJsonString } from "@kunai/types";

/** How long a caller waits to acquire before reporting the config as busy. */
export const CONFIG_LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
/** Release gets its own budget: the critical section may outlive acquisition. */
export const CONFIG_LOCK_RELEASE_TIMEOUT_MS = 5_000;

/** Codes Windows reports for a file that is delete-pending or briefly held by a scanner. */
const WINDOWS_TRANSIENT_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const OWNER_UNLINK_ATTEMPTS = 20;

export type ConfigLockOptions = {
  /** Controlled scheduling seams; omitted by runtime callers. */
  onReclaimMoved?: () => Promise<void>;
  onAcquired?: () => Promise<void>;
  onBeforeRelease?: () => Promise<void>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  /** Filesystem seams for injecting platform errors in tests. */
  platform?: NodeJS.Platform;
  readText?: (path: string) => Promise<string>;
  unlinkFile?: (path: string) => Promise<void>;
};

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Permission denial is not proof of death. PID reuse also errs toward
    // retaining an owner; no platform-specific process probe is required.
    return errorCode(error) !== "ESRCH";
  }
}

type Ticket = {
  pid: number;
  hostname: string;
  ownerId: string;
  ticket: number;
};

/** A ticket file that exists (or may exist) but cannot be read right now. */
const UNREADABLE = Symbol("unreadable-ticket");

function isTransientWindowsError(error: unknown, platform: NodeJS.Platform): boolean {
  const code = errorCode(error);
  return platform === "win32" && code !== undefined && WINDOWS_TRANSIENT_CODES.has(code);
}

async function readTicket(
  path: string,
  options: ConfigLockOptions,
): Promise<Ticket | typeof UNREADABLE | null> {
  const platform = options.platform ?? process.platform;
  const readText = options.readText ?? ((file: string) => Bun.file(file).text());
  try {
    const value: unknown = JSON.parse(await readText(path));
    if (
      !isJsonObject(value) ||
      !isJsonNumber(value.pid) ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      !isJsonString(value.hostname) ||
      !isJsonString(value.ownerId) ||
      !isJsonNumber(value.ticket) ||
      !Number.isSafeInteger(value.ticket) ||
      value.ticket < 0
    ) {
      throw new Error("Invalid config lock ticket");
    }
    let ticket = value.ticket;
    try {
      const number: unknown = JSON.parse(await readText(`${path}.number`));
      if (!isJsonNumber(number) || !Number.isSafeInteger(number) || number <= 0)
        throw new Error("Invalid config lock ticket number");
      ticket = number;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    return { pid: value.pid, hostname: value.hostname, ownerId: value.ownerId, ticket };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    // Delete-pending (owner unlinking) is indistinguishable from a live record
    // a scanner holds. Not "gone": the caller must keep treating it as present.
    if (isTransientWindowsError(error, platform)) return UNREADABLE;
    throw error;
  }
}

/**
 * Lamport's choosing/ticket protocol protects *all* canonical lock transitions.
 * Every participant publishes a fully initialized, uniquely named choosing
 * record before reading max(ticket), then publishes an immutable ticket-number file.
 * Wait for choosing records and earlier (ticket, ownerId) pairs. A newcomer
 * after our directory snapshot must see our published ticket and rank later.
 * Neither choosing nor number files are replaced (including on Windows). Dead-owner paths
 * are unique and never reused, so removing one cannot remove a successor.
 *
 * Unlike a second O_EXCL mutex, this guard's own crash recovery needs no
 * read-then-unlink of a reusable path. Same-host local filesystem required.
 */
export async function withConfigLockTransition<T>(
  lockPath: string,
  deadline: number,
  options: ConfigLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? Bun.sleep;
  const platform = options.platform ?? process.platform;
  const removeFile = options.unlinkFile ?? unlink;
  const ownerId = `${process.pid}-${randomUUID()}`;
  const prefix = `${basename(lockPath)}.ticket-`;
  const ownName = `${prefix}${ownerId}`;
  const path = join(dirname(lockPath), ownName);
  const own: Ticket = { pid: process.pid, hostname: hostname(), ownerId, ticket: 0 };

  type Listing = { tickets: Ticket[]; unreadable: boolean };
  const list = async (): Promise<Listing> => {
    const names = await readdir(dirname(lockPath));
    const tickets: Ticket[] = [];
    let unreadable = false;
    for (const name of names) {
      // Atomic-write temp files are not published choosing records. Our own
      // record is never read back: nobody else unlinks it and its ticket is known.
      if (!name.startsWith(prefix) || name.endsWith(".number") || name === ownName) continue;
      const candidate = join(dirname(lockPath), name);
      const value = await readTicket(candidate, options);
      if (value === null) continue;
      if (value === UNREADABLE) {
        unreadable = true;
        continue;
      }
      if (value.hostname === own.hostname && !pidAlive(value.pid)) {
        await removeFile(`${candidate}.number`).catch(() => {});
        await removeFile(candidate).catch((cause: unknown) => {
          // Another reclaimer may be removing the same dead record (delete-pending on Windows).
          if (errorCode(cause) !== "ENOENT" && !isTransientWindowsError(cause, platform))
            throw cause;
        });
      } else {
        tickets.push(value);
      }
    }
    return { tickets, unreadable };
  };

  const timedOut = () => new Error(`config lock timed out: ${lockPath}`);
  const pause = async () => {
    const remaining = deadline - now();
    if (remaining <= 0) throw timedOut();
    await wait(Math.min(25, remaining));
  };

  // Retry only transient Windows refusals on our own record: a leaked ticket
  // of a live pid would block every other contender until this process exits.
  const removeOwn = async (file: string) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await removeFile(file);
        return;
      } catch (cause) {
        if (errorCode(cause) === "ENOENT") return;
        if (!isTransientWindowsError(cause, platform) || attempt >= OWNER_UNLINK_ATTEMPTS)
          throw cause;
        await wait(25);
      }
    }
  };

  await writeAtomicEphemeralJson(path, own);
  try {
    // The max(ticket) read must see every published number: an unreadable
    // record may carry one, so it is retried, never skipped.
    let snapshot = await list();
    while (snapshot.unreadable) {
      await pause();
      snapshot = await list();
    }
    own.ticket = 1 + Math.max(0, ...snapshot.tickets.map((value) => value.ticket));
    if (!Number.isSafeInteger(own.ticket)) throw new Error("Config lock ticket overflow");
    await writeAtomicEphemeralJson(`${path}.number`, own.ticket);
    for (;;) {
      const { tickets: others, unreadable } = await list();
      const blocked =
        unreadable ||
        others.some(
          (value) =>
            value.hostname !== own.hostname ||
            value.ticket === 0 ||
            value.ticket < own.ticket ||
            (value.ticket === own.ticket && value.ownerId < own.ownerId),
        );
      if (!blocked) return await fn();
      await pause();
    }
  } finally {
    // Only this immutable path belongs to us; never delete another generation.
    await removeOwn(path);
    await removeOwn(`${path}.number`);
  }
}
