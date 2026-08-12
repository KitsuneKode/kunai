// =============================================================================
// Playback Status Policy
//
// The single player-event-to-status table. Pure: no shell, no service, no
// service implementation imports. Every player-driven status transition goes
// through `transitionPlaybackStatus`, so freshness (generation) and authority
// (pause/stop/finish) are decided in exactly one place.
// =============================================================================

import {
  isPlaybackGenerationAfter,
  isSamePlaybackGeneration,
  type PlaybackGeneration,
} from "@/domain/playback/playback-generation";
import type { PlaybackStatus } from "@/domain/session/SessionState";
import type { EndReason } from "@/domain/types";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";

export type PlaybackStatusSnapshot = {
  readonly status: PlaybackStatus;
  readonly generation: PlaybackGeneration;
};

export type PlaybackStatusSignal =
  | {
      readonly kind: "activate";
      readonly generation: PlaybackGeneration;
      readonly status: "loading";
    }
  | {
      readonly kind: "player-event";
      readonly generation: PlaybackGeneration;
      readonly event: PlayerPlaybackEvent;
    }
  | {
      readonly kind: "startup-stall";
      readonly generation: PlaybackGeneration;
    }
  | {
      readonly kind: "completed";
      readonly generation: PlaybackGeneration;
      readonly endReason: EndReason;
    };

export type PlaybackStatusDecision = {
  readonly accepted: boolean;
  readonly snapshot: PlaybackStatusSnapshot;
  /** True when the accepted snapshot must be written back (status or generation moved). */
  readonly statusChanged: boolean;
  readonly clearFeedback: boolean;
};

/** Nothing a player can say revives a session the product already ended. */
function isTerminal(status: PlaybackStatus): boolean {
  return status === "idle" || status === "finished" || status === "error";
}

/** The transient degraded states fresh progress is allowed to recover from. */
function isRecoverable(status: PlaybackStatus): boolean {
  return status === "buffering" || status === "stalled" || status === "seeking";
}

function reject(current: PlaybackStatusSnapshot): PlaybackStatusDecision {
  return { accepted: false, snapshot: current, statusChanged: false, clearFeedback: false };
}

function accept(
  current: PlaybackStatusSnapshot,
  next: PlaybackStatusSnapshot,
  clearFeedback = false,
): PlaybackStatusDecision {
  const statusChanged =
    next.status !== current.status ||
    !isSamePlaybackGeneration(next.generation, current.generation);
  return {
    accepted: true,
    snapshot: next,
    statusChanged,
    clearFeedback: statusChanged && clearFeedback,
  };
}

/** Accepted, but carries no authority to move the status (telemetry, copy, tracks). */
function informational(current: PlaybackStatusSnapshot): PlaybackStatusDecision {
  return { accepted: true, snapshot: current, statusChanged: false, clearFeedback: false };
}

function statusForEndReason(endReason: EndReason): PlaybackStatus {
  if (endReason === "eof") return "finished";
  if (endReason === "quit") return "idle";
  return "error";
}

/**
 * Only `playback-resumed` leaves `paused`. Progress and `playback-started` are
 * rejected outright so they cannot drive presence, history, or feedback either.
 */
function transitionFromPaused(
  current: PlaybackStatusSnapshot,
  event: PlayerPlaybackEvent,
): PlaybackStatusDecision {
  if (event.type === "playback-resumed") {
    return accept(current, { status: "playing", generation: current.generation });
  }
  if (event.type === "playback-progress" || event.type === "playback-started") {
    return reject(current);
  }
  return informational(current);
}

function transitionFromActive(
  current: PlaybackStatusSnapshot,
  event: PlayerPlaybackEvent,
): PlaybackStatusDecision {
  const to = (status: PlaybackStatus, clearFeedback = false) =>
    accept(current, { status, generation: current.generation }, clearFeedback);

  switch (event.type) {
    case "network-buffering":
      return to("buffering");
    case "stream-stalled":
    case "ipc-stalled":
      return to("stalled");
    case "seek-stalled":
      return to("seeking");
    case "playback-started":
    case "playback-resumed":
      return to("playing");
    case "playback-paused":
      return to("paused");
    case "playback-progress":
      return isRecoverable(current.status) ? to("playing", true) : informational(current);
    case "player-ready":
      return current.status === "loading" ? to("ready") : informational(current);
    default:
      return informational(current);
  }
}

export function transitionPlaybackStatus(
  current: PlaybackStatusSnapshot,
  signal: PlaybackStatusSignal,
): PlaybackStatusDecision {
  if (signal.kind === "activate") {
    if (!isPlaybackGenerationAfter(signal.generation, current.generation)) return reject(current);
    return accept(current, { status: signal.status, generation: signal.generation });
  }

  // Everything below is work produced by one specific generation. Only that
  // exact generation may speak; newer generations enter through `activate`.
  if (!isSamePlaybackGeneration(signal.generation, current.generation)) return reject(current);

  if (isTerminal(current.status)) return reject(current);

  if (signal.kind === "completed") {
    return accept(current, {
      status: statusForEndReason(signal.endReason),
      generation: current.generation,
    });
  }

  if (signal.kind === "startup-stall") {
    return accept(current, { status: "stalled", generation: current.generation });
  }

  return current.status === "paused"
    ? transitionFromPaused(current, signal.event)
    : transitionFromActive(current, signal.event);
}
