import type { HistoryProgress, HistoryProgressWatchState } from "@kunai/storage";

/**
 * Watch state for two history rows that turned out to be the same episode.
 *
 * Consolidation picks the surviving row by identity — the most recently touched
 * one — and that is the right call for the key, the title and the ids. It is the
 * wrong call for progress. A row touched a minute ago at 10s and a row from
 * yesterday at 100s describe one person who watched 100s, so keeping the newer
 * row wholesale moved their resume position *backwards*, and could drop a
 * completion they had already earned.
 *
 * Identity therefore comes from the survivor and the watch state is merged here.
 * Every field takes the answer that loses nothing:
 *
 * - `completed` is sticky. Finishing something is not undone by opening it again
 *   under another id, and `completedAt` follows the row that actually finished.
 * - `positionSeconds` takes the furthest point — except once completed, where a
 *   resume offset is noise: a finished episode should offer a replay from the
 *   start, not a seek to wherever the credits were.
 * - `watchedSeconds` is engaged time, and is a maximum rather than a sum. The
 *   two rows describe the same viewing, so adding them would invent time.
 * - `durationSeconds` is a property of the media, so any real value beats a
 *   missing one; when both are present the longer wins, because a truncated
 *   manifest reports short.
 * - `createdAt` reaches back to the earlier row — that is when this title
 *   genuinely entered the library.
 */
export function mergeHistoryWatchState(
  survivor: HistoryProgress,
  dropped: HistoryProgress,
): HistoryProgressWatchState {
  const completed = survivor.completed || dropped.completed;
  const durationSeconds = pickDuration(survivor.durationSeconds, dropped.durationSeconds);
  const completedAt = completedAtOf(survivor, dropped);

  return {
    positionSeconds: completed ? 0 : Math.max(survivor.positionSeconds, dropped.positionSeconds),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    watchedSeconds: Math.max(survivor.watchedSeconds ?? 0, dropped.watchedSeconds ?? 0),
    completed,
    ...(completedAt !== undefined ? { completedAt } : {}),
    lastWatchedAt: laterIso(survivor.lastWatchedAt, dropped.lastWatchedAt),
    createdAt: earlierIso(survivor.createdAt, dropped.createdAt),
  };
}

function pickDuration(left?: number, right?: number): number | undefined {
  const candidates = [left, right].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
}

/** The completion timestamp belongs to whichever row actually completed, earliest first. */
function completedAtOf(survivor: HistoryProgress, dropped: HistoryProgress): string | undefined {
  const stamps = [
    survivor.completed ? survivor.completedAt : undefined,
    dropped.completed ? dropped.completedAt : undefined,
  ].filter(isUsableIso);

  if (stamps.length === 0) return undefined;
  return stamps.reduce((best, value) => (Date.parse(value) < Date.parse(best) ? value : best));
}

function laterIso(left?: string | null, right?: string | null): string | null {
  const stamps = [left, right].filter(isUsableIso);
  if (stamps.length === 0) return null;
  return stamps.reduce((best, value) => (Date.parse(value) > Date.parse(best) ? value : best));
}

function earlierIso(left: string, right: string): string {
  if (!isUsableIso(left)) return right;
  if (!isUsableIso(right)) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function isUsableIso(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}
