import type {
  PlaybackSessionPhaseEvent,
  PlaybackSessionState,
} from "@/app/playback/playback-session-controller";

/**
 * Commits the two state changes that share the confirmed-playback boundary.
 * Process spawn, IPC connection, and player-ready must never call this helper.
 */
export function confirmPlaybackStart(input: {
  readonly session: PlaybackSessionState;
  readonly transition: (
    session: PlaybackSessionState,
    event: Extract<PlaybackSessionPhaseEvent, "playback-started">,
  ) => PlaybackSessionState;
  readonly acknowledgeQueue?: () => void;
}): PlaybackSessionState {
  const session = input.transition(input.session, "playback-started");
  input.acknowledgeQueue?.();
  return session;
}
