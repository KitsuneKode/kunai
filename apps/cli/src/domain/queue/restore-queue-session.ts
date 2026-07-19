// =============================================================================
// restore-queue-session.ts — the single path for bringing a recoverable queue
// session back into the current one.
//
// Restoring the *list* is not enough to resume: the episode that was actually
// playing when the last session ended was already dequeued when it started, so
// a plain reparent hands back everything except the one thing the user most
// wants. We re-derive that head from history rather than writing it at
// shutdown, because history is checkpointed continuously while mpv runs and so
// survives a SIGKILL that never reaches the shutdown coordinator.
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
    "restoreRecoverableSession" | "getAll" | "enqueue" | "moveToTop" | "peekNext" | "getSession"
  >;
  readonly readHistory: () => readonly HistoryProgress[];
};

function isResumable(progress: HistoryProgress): boolean {
  return !isFinished(progress) && progress.positionSeconds >= RESUME_MIN_POSITION_SECONDS;
}

/** Identity for "the queue already contains this exact episode". */
function episodeKey(item: {
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
}): string {
  return `${item.titleId}:${item.season ?? 1}:${item.episode ?? 0}`;
}

export function restoreQueueSessionWithResume(
  deps: RestoreQueueSessionDeps,
  sourceSessionId: string,
): QueueRestoreResult {
  // Read the session's last activity before restoring — the restore closes it.
  const sessionLastActivity = Date.parse(deps.queue.getSession(sourceSessionId)?.updatedAt ?? "");

  const restoredCount = deps.queue.restoreRecoverableSession(sourceSessionId);
  if (restoredCount <= 0) return { restoredCount: 0, resumeHead: undefined };

  // Anything watched after this queue stopped belongs to a later session and was
  // never part of it — without this bound, a movie watched in between would be
  // promoted to the head of a queue it has nothing to do with.
  const resumeCutoff = Number.isNaN(sessionLastActivity)
    ? undefined
    : sessionLastActivity + RESUME_SESSION_GRACE_MS;

  const mostRecentInProgress = [...deps.readHistory()]
    .filter(isResumable)
    .filter((row) => resumeCutoff === undefined || (Date.parse(row.updatedAt) || 0) <= resumeCutoff)
    .sort(
      (left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0),
    )[0];
  if (!mostRecentInProgress) return { restoredCount, resumeHead: undefined };

  const alreadyQueued = new Set(deps.queue.getAll().map(episodeKey));
  if (alreadyQueued.has(episodeKey(mostRecentInProgress))) {
    return { restoredCount, resumeHead: undefined };
  }

  const resumeHead = deps.queue.enqueue({
    title: mostRecentInProgress.title,
    mediaKind: mostRecentInProgress.mediaKind,
    titleId: mostRecentInProgress.titleId,
    season: mostRecentInProgress.season,
    episode: mostRecentInProgress.episode,
    absoluteEpisode: mostRecentInProgress.absoluteEpisode,
    source: "resume",
  });
  deps.queue.moveToTop(resumeHead.id);
  return { restoredCount, resumeHead };
}
