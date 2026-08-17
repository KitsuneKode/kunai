/**
 * "Not right now" as a first-class state, separate from "never".
 *
 * `sync.<tracker>.enabled` is a standing decision: off means the user does not
 * want this tracker. A pause is transient and global — it holds delivery for a
 * while without changing what the user wants. Collapsing the two loses the
 * difference across a restart, and turning sync off to quiet it down is how
 * people end up permanently unsynced by accident.
 *
 * Work still queues while paused. Pausing must never cost an episode.
 */

export type SyncPauseState =
  | { readonly paused: false }
  | { readonly paused: true; readonly until: Date };

/** Presets offered in the UI. Absolute instants, resolved against `now`. */
export type SyncPausePreset = "1h" | "8h" | "tomorrow";

export function resolvePauseState(
  pausedUntil: string | null | undefined,
  now: Date = new Date(),
): SyncPauseState {
  if (!pausedUntil) return { paused: false };
  const until = new Date(pausedUntil);
  // An unparseable or already-elapsed value is simply not a pause. Treating a
  // bad timestamp as "paused forever" would silently stop sync with no way to
  // see why.
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) {
    return { paused: false };
  }
  return { paused: true, until };
}

export function pauseUntil(preset: SyncPausePreset, now: Date = new Date()): string {
  switch (preset) {
    case "1h":
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case "8h":
      return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
    case "tomorrow": {
      // Local next morning, not "now plus 24h" — "until tomorrow" is a
      // wall-clock idea, and a user pausing at 23:50 means the coming morning.
      const next = new Date(now);
      next.setHours(9, 0, 0, 0);
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      return next.toISOString();
    }
  }
}

/** One phrasing of the pause, so every surface says the same thing. */
export function describePauseState(state: SyncPauseState, now: Date = new Date()): string | null {
  if (!state.paused) return null;
  const minutes = Math.max(1, Math.round((state.until.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `paused for ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `paused for ${hours}h`;
  return `paused until ${state.until.toLocaleDateString()}`;
}
