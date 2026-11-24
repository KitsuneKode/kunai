// =============================================================================
// Playback Phase
//
// Handles episode selection → stream resolve → MPV playback → post-playback.
// Returns when user wants to go back to search or switch mode.
// =============================================================================

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

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  private readonly ledger = new PlaybackLedgerSlot();

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
      sleep: (ms) => Bun.sleep(ms),
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
      // Late-bound so a test can replace the countdown on the instance.
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
