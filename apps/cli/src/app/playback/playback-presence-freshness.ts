// =============================================================================
// Playback Presence Freshness
//
// Presence updates are queued as background work, so the state they were built
// from can change before they execute. Discord shows one status at a time, and
// publishing a stale one is worse than publishing nothing: it can announce
// "playing" for a session the user paused, stopped, or replaced.
// =============================================================================

import { isSamePlaybackGeneration } from "@/domain/playback/playback-generation";

import type { PlaybackStatusSnapshot } from "./playback-status-policy";

export type PlaybackPresenceExpectation = PlaybackStatusSnapshot;

/**
 * Exact equality on both status and generation. A queued update is publishable
 * only if nothing about the authoritative snapshot moved since it was scheduled.
 */
export function isPlaybackPresenceUpdateCurrent(
  current: PlaybackStatusSnapshot,
  expected: PlaybackPresenceExpectation,
): boolean {
  return (
    current.status === expected.status &&
    isSamePlaybackGeneration(current.generation, expected.generation)
  );
}
