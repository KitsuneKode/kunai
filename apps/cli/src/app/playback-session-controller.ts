import type { PlaybackControlAction } from "@/infra/player/PlayerControlService";
import type {
  EpisodeInfo,
  PlaybackResult,
  PlaybackTimingMetadata,
  TitleInfo,
} from "@/domain/types";
import {
  didPlaybackEndNearNaturalEnd,
  getAutoAdvanceEpisode,
  type EpisodeAvailability,
} from "@/app/playback-policy";

export type PlaybackAutoplayPauseReason = "user" | "interrupted" | null;
export type PlaybackSessionMode = "manual" | "autoplay-chain";

export type PostPlaybackSessionAction = "toggle-autoplay" | "resume" | "replay";

export interface PlaybackSessionState {
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

type PlaybackResultDecisionArgs = {
  result: PlaybackResult;
  controlAction: PlaybackControlAction | null;
  session: PlaybackSessionState;
  timing?: PlaybackTimingMetadata | null;
};

type AutoAdvanceArgs = {
  result: PlaybackResult;
  title: TitleInfo;
  currentEpisode: EpisodeInfo;
  session: PlaybackSessionState;
  availability: EpisodeAvailability;
  timing?: PlaybackTimingMetadata | null;
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
    mode: autoNextEnabled ? "autoplay-chain" : "manual",
    autoplayPauseReason: null,
    autoplayPaused: false,
    stopAfterCurrent: false,
  };
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

export function resolvePlaybackResultDecision({
  result,
  controlAction,
  session,
  timing,
}: PlaybackResultDecisionArgs): PlaybackResultDecision {
  const nearNaturalEnd = didPlaybackEndNearNaturalEnd(result, timing);
  const interruptedStop = result.endReason === "quit" || controlAction === "stop";
  const shouldTreatAsInterrupted = interruptedStop && !nearNaturalEnd;
  const nextPauseReason =
    shouldTreatAsInterrupted && session.autoplayPauseReason !== "user"
      ? "interrupted"
      : session.autoplayPauseReason;

  return {
    session: withPauseReason(session, nextPauseReason),
    shouldRefreshSource: controlAction === "refresh",
    shouldFallbackProvider: controlAction === "fallback",
    shouldTreatAsInterrupted,
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

export async function resolveAutoplayAdvanceEpisode({
  result,
  title,
  currentEpisode,
  session,
  availability,
  timing,
}: AutoAdvanceArgs): Promise<EpisodeInfo | null> {
  return getAutoAdvanceEpisode(
    result,
    title,
    currentEpisode,
    session.mode === "autoplay-chain" && !session.autoplayPaused && !session.stopAfterCurrent,
    availability,
    timing,
  );
}
