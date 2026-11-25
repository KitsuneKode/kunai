// =============================================================================
// Playback Phase
//
// Handles episode selection → stream resolve → MPV playback → post-playback.
// Returns when user wants to go back to search or switch mode.
//
// `execute` is the outline; each step lives in its own module:
//   playback-phase-session.ts      per-execute session and per-loop state
//   playback-episode-bootstrap.ts  mpv gate, episode / start-point choice
//   playback-episode-iteration.ts  one loop iteration, itself an outline of:
//     playback-episode-attempt.ts    resolve control, source authority, ids
//     playback-episode-context.ts    episode metadata, availability, timing kick
//     playback-stream-acquire.ts     local file / prefetch / recent / resolve
//     playback-stream-ready.ts       timing, preparation, pre-play confirm
//     playback-next-episode-prefetch.ts  near-EOF prefetch and handoff
//     playback-player-launch.ts      launching the player for one file
//     playback-history-persist.ts    history at episode end
//     playback-recovery.ts           dead streams, refresh, failover, fallback
//     playback-control-actions.ts    next/previous/pick/cycle controls
//     playback-auto-advance.ts       catalog auto-next, Up Next
//     playback-post-play-entry.ts    the post-play menu
// =============================================================================

import type { EpisodePrefetchTiming } from "@/app/playback/episode-prefetch";
import { resetLateSubtitleLookups } from "@/app/playback/late-subtitle-resolver";
import {
  bootstrapPlaybackEpisode,
  gatePlaybackStart,
} from "@/app/playback/playback-episode-bootstrap";
import { runEpisodeIteration } from "@/app/playback/playback-episode-iteration";
import { PlaybackLedgerSlot } from "@/app/playback/playback-ledger-slot";
import { type PlaybackOutcome } from "@/app/playback/playback-outcome";
import { updatePlaybackFeedback } from "@/app/playback/playback-phase-feedback";
import {
  createPlaybackLoopState,
  createPlaybackPhaseSession,
  NEXT_ITERATION,
} from "@/app/playback/playback-phase-session";
import { applyMpvEpisodeLoadingOverlay } from "@/app/playback/policies/mpv-transition-overlay-policy";
import { runAutoplayAdvanceCountdown } from "@/app/post-play/autoplay-advance-countdown";
import type { Phase, PhaseResult, PhaseContext } from "@/app/session/Phase";
import { kitsuneErrorFromUnknown } from "@/domain/kitsune-error-mapping";
import type { TitleInfo, EpisodeInfo } from "@/domain/types";

export type { PlaybackOutcome } from "@/app/playback/playback-outcome";

type PlaybackPhaseTiming = {
  readonly countdownSleep?: (ms: number) => Promise<void>;
  readonly prefetchTiming?: EpisodePrefetchTiming;
};

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  private readonly ledger = new PlaybackLedgerSlot();

  constructor(private readonly timing: PlaybackPhaseTiming = {}) {}

  private async runAutoNextCountdown(
    context: PhaseContext,
    episode: EpisodeInfo,
  ): Promise<"continue" | "cancelled" | "skipped"> {
    const { stateManager, playerControl } = context.container;
    const episodeLabel = `S${String(episode.season).padStart(2, "0")}E${String(
      episode.episode,
    ).padStart(2, "0")}`;
    let cancelledByAction = false;

    // Paint the loading pane up front so mpv does not sit on a black idle frame
    // during the countdown (on natural EOF the previous file-loaded already cleared
    // kunai-loading, and the commit-time overlay is 3s away). This is the auto-next
    // analogue of the manual `n` path, which paints locally in the Lua bridge before
    // signalling. Cleared below if the user cancels so a paused-idle window does not
    // keep showing "loading".
    await applyMpvEpisodeLoadingOverlay(playerControl.getActive(), episode);

    const outcome = await runAutoplayAdvanceCountdown({
      seconds: 3,
      signal: context.signal,
      sleep: this.timing.countdownSleep ?? ((ms) => Bun.sleep(ms)),
      onTick: (remaining) => {
        updatePlaybackFeedback(context, {
          detail: "Auto-next ready",
          note: `Next ${episodeLabel} in ${remaining}s  ·  n now  ·  a pause`,
        });
      },
      isCancelled: () => {
        const state = stateManager.getState();
        return cancelledByAction || state.autoplaySessionPaused || state.stopAfterCurrent;
      },
      shouldSkip: () => {
        const action = playerControl.consumeLastAction();
        if (!action) return false;
        if (action === "next") return true;
        if (
          action === "stop" ||
          action === "back-to-search" ||
          action === "previous" ||
          action === "switch-title"
        ) {
          cancelledByAction = true;
        }
        return false;
      },
    });

    if (outcome === "cancelled") {
      // No advance is coming; drop the pre-painted loading pane so the paused idle
      // window is clean instead of frozen on "Loading…".
      await playerControl.getActive()?.setEpisodeTransitionLoading?.(null);
    }

    return outcome;
  }

  async execute(title: TitleInfo, context: PhaseContext): Promise<PhaseResult<PlaybackOutcome>> {
    const { logger, player } = context.container;
    resetLateSubtitleLookups();
    const session = createPlaybackPhaseSession(title, context, {
      ledger: this.ledger,
      prefetchTiming: this.timing.prefetchTiming,
      runAutoNextCountdown: (episode) => this.runAutoNextCountdown(context, episode),
    });
    const { queueAttempt } = session;

    try {
      const blocked = await gatePlaybackStart(session, title);
      if (blocked) return blocked;

      const bootstrap = await bootstrapPlaybackEpisode(session, title);
      if (bootstrap.kind === "exit") return bootstrap.result;

      const loop = createPlaybackLoopState(session, bootstrap);
      while (true) {
        const step = await runEpisodeIteration(loop);
        if (step !== NEXT_ITERATION) return step;
      }
    } catch (e) {
      if (context.signal.aborted) {
        this.ledger.discard();
        updatePlaybackFeedback(context, { detail: null, note: null });
        return { status: "cancelled" };
      }
      logger.error("Playback phase error", { error: String(e) });
      return {
        status: "error",
        error: kitsuneErrorFromUnknown(e, {
          code: "PLAYER_FAILED",
          message: "Playback failed",
          retryable: false,
        }),
      };
    } finally {
      queueAttempt?.rollbackIfUnacknowledged("playback-aborted");
      updatePlaybackFeedback(context, { detail: null, note: null });
      await player.releasePersistentSession();
    }
  }
}
