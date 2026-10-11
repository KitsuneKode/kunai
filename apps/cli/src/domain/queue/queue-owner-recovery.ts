import type { QueueSessionRecord } from "@kunai/storage";

const UNKNOWN_OWNER_STALE_MS = 60 * 60 * 1000;

/** Recovery never claims a verified live sibling or an owner on another host. */
export function shouldRecoverQueueOwner(input: {
  readonly session: QueueSessionRecord;
  readonly hostname: string;
  readonly now: number;
  readonly isAlive: (pid: number) => boolean;
  readonly processStartId: (pid: number) => string | null;
}): boolean {
  const { session } = input;
  if (session.ownerHostname) {
    if (session.ownerHostname !== input.hostname) return false;
    if (session.ownerPid !== undefined) {
      if (!input.isAlive(session.ownerPid)) return true;
      if (!session.ownerProcessStartId) return false;
      const currentStart = input.processStartId(session.ownerPid);
      return currentStart !== null && currentStart !== session.ownerProcessStartId;
    }
  }
  if (session.ownerPid !== undefined && input.isAlive(session.ownerPid)) return false;
  // Keep live legacy PIDs conservatively. Anonymous or dead legacy owners
  // require silence as well, fenced to this exact activity reading.
  const activity = Date.parse(session.lastActivityAt ?? session.updatedAt);
  return !Number.isFinite(activity) || input.now - activity > UNKNOWN_OWNER_STALE_MS;
}
