// =============================================================================
// restore-queue-session.ts — the single path for bringing a recoverable queue
// session back into the current one.
//
// Prefer queue-owned in-flight identity. Legacy history inference is only a
// fallback when no in-flight row exists, and then only to promote an entry that
// already belongs to the restored session — never to invent a new queue row.
// =============================================================================

import type { QueueEntry } from "@kunai/storage";
import type { HistoryProgress } from "@kunai/storage";
import { isHistoryProgressFinished as isFinished } from "@kunai/storage";

import type { QueueService } from "./QueueService";

/**
 * Below this, playback never really started (a mis-click, or a title opened and
 * immediately abandoned) and resuming it would be noise. Matches the threshold
 * the browse idle "continue watching" cue already uses.
 */
const RESUME_MIN_POSITION_SECONDS = 30;

/**
 * How far past the session's own last activity a history row may still be
 * treated as "what was playing when this queue stopped". The session stamp and
 * the final history checkpoint are written moments apart during shutdown, so a
 * small window absorbs that skew — while still rejecting anything watched in a
 * later session, which was never part of this queue.
 */
const RESUME_SESSION_GRACE_MS = 5 * 60 * 1000;

export type QueueRestoreResult = {
  readonly restoredCount: number;
  /** The in-progress episode promoted to the head, if one was found. */
  readonly resumeHead: QueueEntry | undefined;
};

export type RestoreQueueSessionDeps = {
  readonly queue: Pick<
    QueueService,
    "restoreRecoverableSession" | "getAll" | "moveToTop" | "peekNext" | "getSession"
  >;
  readonly readHistory: () => readonly HistoryProgress[];
};

type EpisodeIdentity = {
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
};

function isResumable(progress: HistoryProgress): boolean {
  return !isFinished(progress) && progress.positionSeconds >= RESUME_MIN_POSITION_SECONDS;
}

/** Exact media identity, including absolute anime episode when present. */
function sameEpisodeIdentity(left: EpisodeIdentity, right: EpisodeIdentity): boolean {
  if (left.titleId !== right.titleId) return false;
  if (left.absoluteEpisode !== undefined || right.absoluteEpisode !== undefined) {
    return left.absoluteEpisode === right.absoluteEpisode;
  }
  return (left.season ?? 1) === (right.season ?? 1) && (left.episode ?? 0) === (right.episode ?? 0);
}

function withinSessionWindow(
  historyUpdatedAt: string,
  sessionCreatedAt: string,
  sessionLastActivityAt: string,
): boolean {
  const historyAt = Date.parse(historyUpdatedAt);
  const createdAt = Date.parse(sessionCreatedAt);
  const lastActivityAt = Date.parse(sessionLastActivityAt);
  if (Number.isNaN(historyAt) || Number.isNaN(createdAt) || Number.isNaN(lastActivityAt)) {
    return false;
  }
  return historyAt >= createdAt && historyAt <= lastActivityAt + RESUME_SESSION_GRACE_MS;
}

export function restoreQueueSessionWithResume(
  deps: RestoreQueueSessionDeps,
  sourceSessionId: string,
): QueueRestoreResult {
  // Read session bounds and in-flight identity before restore closes the session.
  const session = deps.queue.getSession(sourceSessionId);
  const { restoredIds, previousInFlightId } = deps.queue.restoreRecoverableSession(sourceSessionId);
  if (restoredIds.length <= 0) return { restoredCount: 0, resumeHead: undefined };

  const restoredIdSet = new Set(restoredIds);
  const restoredEntries = deps.queue.getAll().filter((entry) => restoredIdSet.has(entry.id));

  let resumeHead: QueueEntry | undefined;
  if (previousInFlightId) {
    resumeHead = restoredEntries.find((entry) => entry.id === previousInFlightId);
  } else if (session) {
    const lastActivityAt = session.lastActivityAt ?? session.updatedAt;
    const mostRecentMatch = [...deps.readHistory()]
      .filter(isResumable)
      .filter((row) => withinSessionWindow(row.updatedAt, session.createdAt, lastActivityAt))
      .sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0))
      .map((row) => restoredEntries.find((entry) => sameEpisodeIdentity(entry, row)))
      .find((entry): entry is QueueEntry => entry !== undefined);
    resumeHead = mostRecentMatch;
  }

  if (resumeHead) {
    deps.queue.moveToTop(resumeHead.id);
  }
  return { restoredCount: restoredIds.length, resumeHead };
}
