import type { SessionState, StateTransition } from "./SessionState";

/** Playback status and failover transitions. Null when the transition is unrelated. */
export function reducePlaybackSessionTransition(
  state: SessionState,
  transition: StateTransition,
): SessionState | null {
  switch (transition.type) {
    case "SET_PLAYBACK_STATUS": {
      const keepPlaybackFeedback =
        transition.clearFeedback !== true &&
        (transition.status === "loading" ||
          transition.status === "buffering" ||
          transition.status === "seeking" ||
          transition.status === "stalled" ||
          transition.status === "playing" ||
          transition.status === "paused");
      const leavingPlayback = transition.status === "idle" || transition.status === "finished";
      return {
        ...state,
        playbackStatus: transition.status,
        playbackGeneration: transition.generation ?? state.playbackGeneration,
        playbackError: transition.error ?? null,
        playbackDetail: keepPlaybackFeedback ? state.playbackDetail : null,
        playbackNote: keepPlaybackFeedback ? state.playbackNote : null,
        playbackProblem: transition.status === "loading" ? null : state.playbackProblem,
        playbackFailover: leavingPlayback ? null : state.playbackFailover,
        playbackRecoveryRequest: leavingPlayback ? null : state.playbackRecoveryRequest,
        ...(leavingPlayback ? { currentAnimeEpisodes: null } : {}),
      };
    }
    case "SET_PLAYBACK_FAILOVER":
      return { ...state, playbackFailover: transition.failover };
    case "SET_PLAYBACK_RECOVERY_REQUEST":
      return { ...state, playbackRecoveryRequest: transition.request };
    default:
      return null;
  }
}
