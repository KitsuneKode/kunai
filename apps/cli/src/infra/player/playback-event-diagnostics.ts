import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import {
  buildPlaybackDiagnosticEvent,
  type DiagnosticFailureClass,
} from "@/services/diagnostics/diagnostic-event-helpers";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";

import {
  classifyPlaybackFailureFromEvent,
  recoveryForPlaybackFailure,
} from "./playback-failure-classifier";
import type {
  PlayerOptions,
  PlayerPlaybackEvent,
  PlayerPlaybackEventEnvelope,
} from "./PlayerService";

/**
 * The single public playback-event boundary. Raw mpv events stay below it;
 * consumers receive a generation envelope and diagnostics cannot be published
 * by a retired generation.
 */
export function wrapPlaybackEventDiagnostics(input: {
  readonly generation: PlaybackGeneration;
  readonly handler: ((event: PlayerPlaybackEventEnvelope) => void) | undefined;
  readonly correlation?: PlayerOptions["correlation"];
  readonly isCurrentGeneration: (generation: PlaybackGeneration) => boolean;
  readonly diagnostics: Pick<DiagnosticsService, "record">;
}): (event: PlayerPlaybackEvent) => void {
  return (event) => {
    if (!input.isCurrentGeneration(input.generation)) return;
    const failureClass = classifyPlaybackFailureFromEvent(event);
    const diagnosticFailureClass = mapPlaybackFailureToDiagnosticFailure(failureClass);
    input.diagnostics.record(
      buildPlaybackDiagnosticEvent({
        operation: operationForPlaybackEvent(event),
        stage: event.type,
        status: diagnosticFailureClass ? "failed" : "progress",
        severity: diagnosticFailureClass ? "degraded" : "healthy",
        failureClass: diagnosticFailureClass,
        message: "MPV runtime event",
        correlation: input.correlation,
        context: {
          event: event.type,
          ...event,
          playbackFailureClass: failureClass,
          recovery: recoveryForPlaybackFailure(failureClass),
        },
      }),
    );
    input.handler?.({ generation: input.generation, event });
  };
}

function operationForPlaybackEvent(event: PlayerPlaybackEvent): string {
  switch (event.type) {
    case "network-buffering":
    case "network-sample":
    case "stream-slow":
    case "stream-stalled":
      return "mpv.network.sample";
    case "ipc-command-failed":
    case "ipc-stalled":
    case "mpv-in-process-reconnect":
      return "mpv.ipc.event";
    default:
      return "mpv.runtime.event";
  }
}

function mapPlaybackFailureToDiagnosticFailure(
  failureClass: ReturnType<typeof classifyPlaybackFailureFromEvent>,
): DiagnosticFailureClass | undefined {
  switch (failureClass) {
    case "none":
      return undefined;
    case "network-buffering":
    case "slow-stream":
    case "expired-stream":
      return "http";
    case "seek-stuck":
      return "timeout";
    case "ipc-stuck":
      return "ipc";
    default:
      return "unknown";
  }
}
