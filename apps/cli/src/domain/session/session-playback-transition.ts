import type { PlaybackFailoverNotice } from "../playback/playback-failover-notice";
import type { SessionState, StateTransition } from "./SessionState";

/** A mid-stream hop with a destination waits for a later `playing` status. */
function failoverAwaitsPlayback(notice: PlaybackFailoverNotice | null): boolean {
  return notice?.phase === "mid-stream" && Boolean(notice.toLabel);
}

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
      const clearFailover =
        leavingPlayback || (transition.status === "playing" && state.failoverAwaitingPlayback);
      return {
        ...state,
        playbackStatus: transition.status,
        playbackGeneration: transition.generation ?? state.playbackGeneration,
        playbackError: transition.error ?? null,
        playbackDetail: keepPlaybackFeedback ? state.playbackDetail : null,
        playbackNote: keepPlaybackFeedback ? state.playbackNote : null,
        playbackProblem: transition.status === "loading" ? null : state.playbackProblem,
        playbackFailover: clearFailover ? null : state.playbackFailover,
        failoverAwaitingPlayback: clearFailover ? false : state.failoverAwaitingPlayback,
        playbackRecoveryRequest: leavingPlayback ? null : state.playbackRecoveryRequest,
        ...(leavingPlayback ? { currentAnimeEpisodes: null } : {}),
      };
    }
    case "SET_PLAYBACK_FAILOVER":
      return {
        ...state,
        playbackFailover: transition.failover,
        failoverAwaitingPlayback: failoverAwaitsPlayback(transition.failover),
      };
    case "SET_PLAYBACK_RECOVERY_REQUEST":
      return { ...state, playbackRecoveryRequest: transition.request };
    default:
      return null;
  }
}
