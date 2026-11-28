// =============================================================================
// Playback phase feedback surface
//
// The writers PlaybackPhase uses to tell the shell what playback is doing:
// the feedback line, session-phase transitions (with their diagnostic), the
// player-driven status, and the blocking problem/error surface.
// =============================================================================
import { companionMode } from "@/app-shell/companion-policy";
import { kannaDoneKindForSkipKind, kannaDoneText } from "@/app-shell/kanna-voice";
import { capturePlaybackShellError } from "@/app-shell/playback-shell-error-capture";
import { type MpvPlaybackFeedback } from "@/app/playback/mpv-playback-event-copy";
import { releasePersistentMpvForTerminalFailure } from "@/app/playback/mpv-session-lifecycle";
import {
  transitionPlaybackSessionPhase,
  type PlaybackSessionPhaseEvent,
  type PlaybackSessionState,
} from "@/app/playback/playback-session-controller";
import {
  transitionPlaybackStatus,
  type PlaybackStatusDecision,
  type PlaybackStatusSignal,
} from "@/app/playback/playback-status-policy";
import type { PhaseContext } from "@/app/session/Phase";
import type { Container } from "@/container";
import { type PlaybackProblem } from "@/domain/playback/playback-problem";

export function updatePlaybackFeedback(context: PhaseContext, feedback: MpvPlaybackFeedback) {
  // A successful skip is the companion's moment: when she is enabled the
  // factual "Intro skipped" sentence becomes her line in the same slot. Off
  // keeps the factual note, so the state surface never loses the event.
  const note =
    feedback.skipKind !== undefined
      ? (kannaDoneText(kannaDoneKindForSkipKind(feedback.skipKind), companionMode()) ??
        feedback.note)
      : feedback.note;
  context.container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    detail: feedback.detail,
    note,
  });
}

export function transitionPlaybackSession(
  context: PhaseContext,
  session: PlaybackSessionState,
  event: PlaybackSessionPhaseEvent,
  meta: Record<string, unknown> = {},
): PlaybackSessionState {
  const nextSession = transitionPlaybackSessionPhase(session, event);
  if (nextSession.phase !== session.phase) {
    context.container.diagnosticsService.record({
      category: "playback",
      operation: "playback.session.phase",
      message: `Playback session phase: ${nextSession.phase}`,
      context: {
        from: session.phase,
        to: nextSession.phase,
        event,
        ...meta,
      },
    });
  }
  return nextSession;
}

/**
 * The single writer of player-driven playback status. Reads the authoritative
 * snapshot, asks the pure policy, and writes back only when the policy says
 * the status or generation actually moved.
 */
export function applyPlaybackStatusSignal(
  context: PhaseContext,
  signal: PlaybackStatusSignal,
): PlaybackStatusDecision {
  const { stateManager } = context.container;
  const state = stateManager.getState();
  const decision = transitionPlaybackStatus(
    { status: state.playbackStatus, generation: state.playbackGeneration },
    signal,
  );
  if (decision.accepted && decision.statusChanged) {
    stateManager.dispatch({
      type: "SET_PLAYBACK_STATUS",
      status: decision.snapshot.status,
      generation: decision.snapshot.generation,
      clearFeedback: decision.clearFeedback,
    });
  }
  return decision;
}

/** Dispatches the error status to the UI and waits for the user to dismiss it. */
export async function showPlaybackError(
  context: PhaseContext,
  message: string,
  cause?: unknown,
): Promise<void> {
  if (cause !== undefined) {
    capturePlaybackShellError(cause);
  } else {
    capturePlaybackShellError(new Error(message));
  }
  const { stateManager } = context.container;
  stateManager.dispatch({
    type: "SET_PLAYBACK_STATUS",
    status: "error",
    error: message,
  });
  // The wait is parked on a user dismissal transition; session shutdown must
  // release it too, otherwise the phase outlives the abort and the loop's
  // stop path has to force-settle around a still-pending run.
  if (context.signal.aborted) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = stateManager.subscribe((state) => {
      if (state.playbackStatus !== "error") {
        unsubscribe();
        resolve();
      }
    });
    context.signal.addEventListener(
      "abort",
      () => {
        unsubscribe();
        resolve();
      },
      { once: true },
    );
  });
}

export type StartupFailureDecision = "retry" | "dismiss" | "tracks";

/**
 * Park on the playback-issue panel until the user retries, opens Tracks, or
 * leaves. Session abort counts as dismiss so shutdown cannot wait forever.
 */
export async function presentStartupPlaybackFailure(input: {
  readonly container: Pick<Container, "stateManager">;
  readonly signal: AbortSignal;
  readonly problem: PlaybackProblem;
}): Promise<StartupFailureDecision> {
  const { stateManager } = input.container;
  stateManager.dispatch({ type: "SET_PLAYBACK_PROBLEM", problem: input.problem });
  stateManager.dispatch({
    type: "SET_PLAYBACK_STATUS",
    status: "error",
    error: input.problem.userMessage,
  });
  stateManager.dispatch({ type: "SET_PLAYBACK_RECOVERY_REQUEST", request: null });
  if (input.signal.aborted) return "dismiss";

  return new Promise((resolve) => {
    let settled = false;
    const finish = (decision: StartupFailureDecision) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      input.signal.removeEventListener("abort", onAbort);
      resolve(decision);
    };
    const onAbort = () => finish("dismiss");
    const unsubscribe = stateManager.subscribe((state) => {
      if (settled) return;
      if (state.playbackRecoveryRequest === "tracks") {
        finish("tracks");
        stateManager.dispatch({ type: "SET_PLAYBACK_RECOVERY_REQUEST", request: null });
        return;
      }
      if (state.playbackStatus === "loading") finish("retry");
      else if (state.playbackStatus !== "error") finish("dismiss");
    });
    input.signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function showPlaybackProblem(
  context: PhaseContext,
  problem: PlaybackProblem,
): Promise<"dismiss" | "retry"> {
  const { diagnosticsService, stateManager, player, playerControl } = context.container;
  stateManager.dispatch({
    type: "SET_PLAYBACK_PROBLEM",
    problem,
  });
  diagnosticsService.record({
    category: "playback",
    message: problem.userMessage,
    context: {
      stage: problem.stage,
      severity: problem.severity,
      cause: problem.cause,
      recommendedAction: problem.recommendedAction,
      secondaryActions: problem.secondaryActions,
    },
  });
  await releasePersistentMpvForTerminalFailure({
    player,
    playerControl,
    userMessage: problem.userMessage,
    reason: `provider-resolve:${problem.cause}`,
    diagnostics: diagnosticsService,
  });
  await showPlaybackError(context, problem.userMessage);
  return stateManager.getState().playbackStatus === "loading" ? "retry" : "dismiss";
}
