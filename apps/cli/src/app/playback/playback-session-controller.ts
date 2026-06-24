import {
  didPlaybackFailToStart,
  explainAutoplayBlockReason,
  explainAutoplayNoNextEpisodeCatalogHint,
  resolveAutoplayAdvanceEpisode,
  resolvePlaybackResultDecision,
  type AutoAdvanceArgs,
  type AutoAdvanceBlockReason,
} from "@/app/playback/policies/playback-result-policy";
import { playbackSessionPhaseForEvent } from "@/app/playback/policies/playback-session-phase-policy";

export type PlaybackAutoplayPauseReason = "user" | "interrupted" | null;
export type PlaybackSessionPhase =
  | "selecting"
  | "resolving"
  | "ready"
  | "playing"
  | "ending"
  | "recovering"
  | "post-playback"
  | "failed";
export type PlaybackSessionPhaseEvent =
  | "episode-selected"
  | "resolve-started"
  | "stream-ready"
  | "playback-started"
  | "playback-ended"
  | "recovery-started"
  | "post-playback-opened"
  | "failure-shown"
  | "resume-requested"
  | "replay-requested"
  | "episode-navigation";
export type PlaybackSessionMode = "manual" | "autoplay-chain";

export type PostPlaybackSessionAction = "toggle-autoplay" | "resume" | "replay";

export interface PlaybackSessionState {
  readonly phase: PlaybackSessionPhase;
  readonly mode: PlaybackSessionMode;
  readonly autoplayPauseReason: PlaybackAutoplayPauseReason;
  readonly autoplayPaused: boolean;
  readonly stopAfterCurrent: boolean;
}

export interface PlaybackResultDecision {
  readonly session: PlaybackSessionState;
  readonly shouldRefreshSource: boolean;
  readonly shouldFallbackProvider: boolean;
  readonly shouldTreatAsInterrupted: boolean;
}

export interface PlaybackActionDecision {
  readonly session: PlaybackSessionState;
}

export type { AutoAdvanceArgs, AutoAdvanceBlockReason };

export {
  didPlaybackFailToStart,
  explainAutoplayBlockReason,
  explainAutoplayNoNextEpisodeCatalogHint,
  resolveAutoplayAdvanceEpisode,
  resolvePlaybackResultDecision,
};

export function syncPlaybackSessionState(
  session: PlaybackSessionState,
  shellState: {
    autoplaySessionPaused: boolean;
    stopAfterCurrent: boolean;
  },
): PlaybackSessionState {
  return {
    ...session,
    autoplayPauseReason: shellState.autoplaySessionPaused
      ? (session.autoplayPauseReason ?? "user")
      : null,
    autoplayPaused: shellState.autoplaySessionPaused,
    stopAfterCurrent: shellState.stopAfterCurrent,
  };
}

export function createPlaybackSessionState({
  autoNextEnabled,
}: {
  autoNextEnabled: boolean;
}): PlaybackSessionState {
  return {
    phase: "selecting",
    mode: autoNextEnabled ? "autoplay-chain" : "manual",
    autoplayPauseReason: null,
    autoplayPaused: false,
    stopAfterCurrent: false,
  };
}

export function transitionPlaybackSessionPhase(
  session: PlaybackSessionState,
  event: PlaybackSessionPhaseEvent,
): PlaybackSessionState {
  const phase = playbackSessionPhaseForEvent(event);
  return phase === session.phase ? session : { ...session, phase };
}

function withPauseReason(
  session: PlaybackSessionState,
  autoplayPauseReason: PlaybackAutoplayPauseReason,
): PlaybackSessionState {
  return {
    ...session,
    autoplayPauseReason,
    autoplayPaused: autoplayPauseReason !== null,
  };
}

export function resolvePostPlaybackSessionAction(
  action: PostPlaybackSessionAction,
  session: PlaybackSessionState,
): PlaybackActionDecision {
  switch (action) {
    case "toggle-autoplay": {
      const nextPauseReason = session.autoplayPauseReason === null ? "user" : null;
      return {
        session: withPauseReason(session, nextPauseReason),
      };
    }
    case "resume":
    case "replay": {
      const nextPauseReason =
        session.autoplayPauseReason === "interrupted" ? null : session.autoplayPauseReason;
      return {
        session: withPauseReason(session, nextPauseReason),
      };
    }
  }
}
