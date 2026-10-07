import { randomUUID } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";

import { writeAtomicSecretJson } from "@/infra/fs/atomic-write";
import { isJsonObject, isJsonNumber, isJsonString } from "@kunai/types";

export type ConfigLockOptions = {
  /** Controlled scheduling seams; omitted by runtime callers. */
  onReclaimMoved?: () => Promise<void>;
  onAcquired?: () => Promise<void>;
  onBeforeRelease?: () => Promise<void>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

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

async function readTicket(path: string): Promise<Ticket | null> {
  try {
    const value: unknown = await Bun.file(path).json();
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
      const number: unknown = await Bun.file(`${path}.number`).json();
      if (!isJsonNumber(number) || !Number.isSafeInteger(number) || number <= 0)
        throw new Error("Invalid config lock ticket number");
      ticket = number;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    return { pid: value.pid, hostname: value.hostname, ownerId: value.ownerId, ticket };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
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
  const ownerId = `${process.pid}-${randomUUID()}`;
  const prefix = `${basename(lockPath)}.ticket-`;
  const path = join(dirname(lockPath), `${prefix}${ownerId}`);
  const own: Ticket = { pid: process.pid, hostname: hostname(), ownerId, ticket: 0 };

  const list = async (): Promise<{ path: string; value: Ticket }[]> => {
    const names = await readdir(dirname(lockPath));
    const tickets: { path: string; value: Ticket }[] = [];
    for (const name of names) {
      // Atomic-write temp files are not published choosing records.
      if (!name.startsWith(prefix) || name.endsWith(".number")) continue;
      const candidate = join(dirname(lockPath), name);
      const value = await readTicket(candidate);
      if (!value) continue;
      if (value.hostname === own.hostname && !pidAlive(value.pid)) {
        await unlink(`${candidate}.number`).catch(() => {});
        await unlink(candidate).catch((error: unknown) => {
          if (errorCode(error) !== "ENOENT") throw error;
        });
      } else {
        tickets.push({ path: candidate, value });
      }
    }
    return tickets;
  };

  await writeAtomicSecretJson(path, own);
  try {
    const tickets = await list();
    own.ticket = 1 + Math.max(0, ...tickets.map(({ value }) => value.ticket));
    if (!Number.isSafeInteger(own.ticket)) throw new Error("Config lock ticket overflow");
    await writeAtomicSecretJson(`${path}.number`, own.ticket);
    for (;;) {
      const others = await list();
      const blocked = others.some(
        ({ path: otherPath, value }) =>
          otherPath !== path &&
          (value.hostname !== own.hostname ||
            value.ticket === 0 ||
            value.ticket < own.ticket ||
            (value.ticket === own.ticket && value.ownerId < own.ownerId)),
      );
      if (!blocked) return await fn();
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error(`config lock timed out: ${lockPath}`);
      await wait(Math.min(25, remaining));
    }
  } finally {
    // Only this immutable path belongs to us; never delete another generation.
    await unlink(path).catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") throw error;
    });
    await unlink(`${path}.number`).catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") throw error;
    });
  }
}
