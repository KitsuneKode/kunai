import {
  didPlaybackEndNearNaturalEnd,
  describeAutoplayCatalogCaughtUpBanner,
  getAutoAdvanceEpisode,
  type EpisodeAvailability,
  type PlaybackEndPolicy,
  DEFAULT_PLAYBACK_END_POLICY,
} from "@/app/playback-policy";
import type {
  EpisodeInfo,
  PlaybackResult,
  PlaybackTimingMetadata,
  TitleInfo,
} from "@/domain/types";
import type { PlaybackControlAction } from "@/infra/player/PlayerControlService";

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

/** True when mpv never meaningfully started (load failure, dead URL, immediate exit). */
export function didPlaybackFailToStart(result: PlaybackResult): boolean {
  if (result.endReason === "eof" || result.endReason === "quit") {
    return false;
  }
  if (result.suspectedDeadStream === true) {
    return true;
  }
  if (result.watchedSeconds >= 30) {
    return false;
  }
  if ((result.lastNonZeroPositionSeconds ?? 0) > 10) {
    return false;
  }
  if (result.endReason === "error") {
    return true;
  }
  if (
    result.endReason === "unknown" &&
    result.watchedSeconds <= 0 &&
    result.duration <= 0 &&
    result.playerExitCode !== null &&
    result.playerExitCode !== 0
  ) {
    return true;
  }
  return false;
}

export interface PlaybackActionDecision {
  readonly session: PlaybackSessionState;
}

type PlaybackResultDecisionArgs = {
  result: PlaybackResult;
  controlAction: PlaybackControlAction | null;
  session: PlaybackSessionState;
  timing?: PlaybackTimingMetadata | null;
  endPolicy?: PlaybackEndPolicy;
};

type AutoAdvanceArgs = {
  result: PlaybackResult;
  title: TitleInfo;
  currentEpisode: EpisodeInfo;
  session: PlaybackSessionState;
  availability: EpisodeAvailability;
  timing?: PlaybackTimingMetadata | null;
  endPolicy?: PlaybackEndPolicy;
};

export type AutoAdvanceBlockReason =
  | "manual-mode"
  | "autoplay-paused"
  | "stop-after-current"
  | "not-series"
  | "not-near-end"
  | "quit-stops-autoplay"
  | "next-episode-not-released-yet"
  | "anime-next-uncertain"
  | "no-next-episode";

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

function playbackSessionPhaseForEvent(event: PlaybackSessionPhaseEvent): PlaybackSessionPhase {
  switch (event) {
    case "episode-selected":
    case "resolve-started":
    case "resume-requested":
    case "replay-requested":
    case "episode-navigation":
      return "resolving";
    case "stream-ready":
      return "ready";
    case "playback-started":
      return "playing";
    case "playback-ended":
      return "ending";
    case "recovery-started":
      return "recovering";
    case "post-playback-opened":
      return "post-playback";
    case "failure-shown":
      return "failed";
  }
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
  endPolicy = DEFAULT_PLAYBACK_END_POLICY,
}: PlaybackResultDecisionArgs): PlaybackResultDecision {
  const nearNaturalEnd = didPlaybackEndNearNaturalEnd(
    result,
    timing,
    endPolicy.quitNearEndThresholdMode,
  );
  // These actions carry explicit "keep watching this episode" intent, so the mpv
  // "quit" they trigger (mpv is stopped to re-resolve/recover/navigate) must NOT be
  // misread as a user interruption that pauses autoplay. Switching provider, source,
  // or quality, or recovering a dead stream, all re-resolve the SAME episode — only
  // a real `stop` (or an unattributed quit) should defensively pause autoplay.
  const keepsWatchingIntent =
    controlAction === "next" ||
    controlAction === "previous" ||
    controlAction === "pick-episode" ||
    controlAction === "back-to-search" ||
    controlAction === "refresh" ||
    controlAction === "recover" ||
    controlAction === "recompute" ||
    controlAction === "fallback" ||
    controlAction === "pick-stream" ||
    controlAction === "pick-source" ||
    controlAction === "pick-quality" ||
    controlAction === "reload-subtitles" ||
    controlAction === "select-subtitle";
  const interruptedStop =
    !keepsWatchingIntent && (result.endReason === "quit" || controlAction === "stop");
  const shouldTreatAsInterrupted = interruptedStop && !nearNaturalEnd;
  const nextPauseReason =
    shouldTreatAsInterrupted && session.autoplayPauseReason !== "user"
      ? "interrupted"
      : session.autoplayPauseReason;

  return {
    session: withPauseReason(session, nextPauseReason),
    shouldRefreshSource:
      result.suspectedDeadStream === true ||
      didPlaybackFailToStart(result) ||
      controlAction === "refresh" ||
      controlAction === "recover" ||
      controlAction === "recompute",
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
  endPolicy = DEFAULT_PLAYBACK_END_POLICY,
}: AutoAdvanceArgs): Promise<EpisodeInfo | null> {
  return getAutoAdvanceEpisode(
    result,
    title,
    currentEpisode,
    session.mode === "autoplay-chain" && !session.autoplayPaused && !session.stopAfterCurrent,
    availability,
    timing,
    endPolicy,
  );
}

export function explainAutoplayBlockReason(args: AutoAdvanceArgs): AutoAdvanceBlockReason | null {
  const {
    result,
    title,
    session,
    availability,
    timing,
    endPolicy = DEFAULT_PLAYBACK_END_POLICY,
  } = args;
  const thresholdMode = endPolicy.quitNearEndThresholdMode;
  if (result.suspectedDeadStream) return "not-near-end";
  const nearNaturalEnd = didPlaybackEndNearNaturalEnd(result, timing, thresholdMode);
  const endAllowsAutoplayAdvance =
    result.endReason === "eof" ||
    (result.endReason === "quit" && endPolicy.quitNearEndBehavior === "continue" && nearNaturalEnd);

  if (session.mode !== "autoplay-chain") return "manual-mode";
  if (session.autoplayPaused) return "autoplay-paused";
  if (session.stopAfterCurrent) return "stop-after-current";
  if (title.type !== "series") return "not-series";
  if (result.endReason === "quit" && endPolicy.quitNearEndBehavior === "pause") {
    if (nearNaturalEnd) return "quit-stops-autoplay";
    return "not-near-end";
  }
  if (!endAllowsAutoplayAdvance) return "not-near-end";
  if (!availability.nextEpisode) {
    if (availability.upcomingNext) return "next-episode-not-released-yet";
    if (availability.animeNextReleaseUnknown) return "anime-next-uncertain";
    return "no-next-episode";
  }
  return null;
}

const catalogAutoplayHints: ReadonlySet<AutoAdvanceBlockReason> = new Set([
  "no-next-episode",
  "next-episode-not-released-yet",
  "anime-next-uncertain",
]);

/** Human copy when autoplay stopped on catalog end / upcoming / uncertain; pairs with {@link explainAutoplayBlockReason}. */
export function explainAutoplayNoNextEpisodeCatalogHint(
  args: AutoAdvanceArgs & { isAnime: boolean },
): string | undefined {
  const reason = explainAutoplayBlockReason(args);
  if (!reason || !catalogAutoplayHints.has(reason)) return undefined;
  return describeAutoplayCatalogCaughtUpBanner(args.availability, args.isAnime) ?? undefined;
}
