import type {
  PlaybackAutoplayPauseReason,
  PlaybackResultDecision,
  PlaybackSessionState,
} from "@/app/playback/playback-session-controller";
import {
  didPlaybackEndNearNaturalEnd,
  describeAutoplayCatalogCaughtUpBanner,
  getAutoAdvanceEpisode,
  type EpisodeAvailability,
  type PlaybackEndPolicy,
  DEFAULT_PLAYBACK_END_POLICY,
} from "@/domain/playback/playback-policy";
import {
  isDidNotStartProgress,
  trustedProgressFromPlaybackResult,
} from "@/domain/playback/progress-engage-policy";
import type {
  EpisodeInfo,
  PlaybackResult,
  PlaybackTimingMetadata,
  TitleInfo,
} from "@/domain/types";
import type { PlaybackControlAction } from "@/infra/player/PlayerControlService";

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

type PlaybackResultDecisionArgs = {
  result: PlaybackResult;
  controlAction: PlaybackControlAction | null;
  session: PlaybackSessionState;
  timing?: PlaybackTimingMetadata | null;
  endPolicy?: PlaybackEndPolicy;
};

export type AutoAdvanceArgs = {
  result: PlaybackResult;
  title: TitleInfo;
  currentEpisode: EpisodeInfo;
  session: PlaybackSessionState;
  availability: EpisodeAvailability;
  timing?: PlaybackTimingMetadata | null;
  endPolicy?: PlaybackEndPolicy;
};

/** True when mpv never meaningfully started (load failure, dead URL, immediate exit). */
/**
 * Did this playback session actually start?
 *
 * Answered from evidence, never from how much was watched. "Nothing was
 * recorded for this title" and "playback didn't start" are different claims,
 * and only the second one tells the user the app failed — so it has to be
 * proven, by one of:
 *
 * - a failure the player reported (`didPlaybackFailToStart`), or
 * - a file that loaded with a known duration and never advanced
 *   (`isDidNotStartProgress`, the same policy the history ledger uses).
 *
 * Everything else started. A twelve-second watch is a short session; a session
 * whose IPC stats never arrived is unmeasured. Neither is a failure to start,
 * and reporting them as one is what teaches a user to distrust every status
 * the app shows afterwards.
 */
export function didPlaybackStart(result: PlaybackResult): boolean {
  if (didPlaybackFailToStart(result)) return false;
  // mpv reaching the end of the file is direct evidence that it played it, and
  // outranks a missing progress sample: `isDidNotStartProgress` reads a known
  // duration with no trusted progress as "never advanced", which is exactly the
  // shape an EOF with no IPC samples takes.
  if (result.endReason === "eof") return true;
  return !isDidNotStartProgress(trustedProgressFromPlaybackResult(result));
}

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
    !keepsWatchingIntent &&
    !didPlaybackFailToStart(result) &&
    (result.endReason === "quit" || controlAction === "stop");
  const shouldTreatAsInterrupted = interruptedStop && !nearNaturalEnd;
  const nextPauseReason =
    shouldTreatAsInterrupted && session.autoplayPauseReason !== "user"
      ? "interrupted"
      : session.autoplayPauseReason;

  const heuristicRefresh = result.suspectedDeadStream === true || didPlaybackFailToStart(result);
  const blockHeuristicRefreshOnCleanQuit =
    result.endReason === "quit" && (result.playerExitedCleanly ?? false);

  return {
    session: withPauseReason(session, nextPauseReason),
    shouldRefreshSource:
      controlAction === "refresh" ||
      controlAction === "recover" ||
      controlAction === "recompute" ||
      (heuristicRefresh && !blockHeuristicRefreshOnCleanQuit),
    shouldFallbackProvider: controlAction === "fallback",
    shouldTreatAsInterrupted,
  };
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
  const endAllowsAutoplayAdvance = result.endReason === "eof";

  if (session.mode !== "autoplay-chain") return "manual-mode";
  if (session.autoplayPaused) return "autoplay-paused";
  if (session.stopAfterCurrent) return "stop-after-current";
  if (title.type !== "series") return "not-series";
  if (result.endReason === "quit" && endPolicy.quitNearEndBehavior === "pause") {
    if (nearNaturalEnd) return "quit-stops-autoplay";
    return "not-near-end";
  }
  if (!endAllowsAutoplayAdvance) return "not-near-end";
  if (!nearNaturalEnd) return "not-near-end";
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

export function explainAutoplayNoNextEpisodeCatalogHint(
  args: AutoAdvanceArgs & { isAnime: boolean },
): string | undefined {
  const reason = explainAutoplayBlockReason(args);
  if (!reason || !catalogAutoplayHints.has(reason)) return undefined;
  return describeAutoplayCatalogCaughtUpBanner(args.availability, args.isAnime) ?? undefined;
}
