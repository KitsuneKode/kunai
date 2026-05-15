import type { PlaybackResult } from "@/domain/types";

import type { PlayerPlaybackEvent } from "./PlayerService";

export type PlaybackFailureClass =
  | "none"
  | "network-buffering"
  | "expired-stream"
  | "seek-stuck"
  | "ipc-stuck"
  | "player-exited"
  | "unknown";

export interface PlaybackRecoveryGuidance {
  readonly action: "none" | "wait" | "refresh" | "pick-stream" | "relaunch" | "inspect";
  readonly label: string;
}

export function classifyPlaybackFailureFromEvent(event: PlayerPlaybackEvent): PlaybackFailureClass {
  switch (event.type) {
    case "network-buffering":
      if ((event.cacheSpeed ?? 0) <= 0 && (event.cacheAheadSeconds ?? 0) <= 0) {
        return "expired-stream";
      }
      return "network-buffering";
    case "seek-stalled":
      return "seek-stuck";
    case "ipc-stalled":
      return "ipc-stuck";
    case "stream-stalled":
      if (event.stallKind === "network-read-dead") return "expired-stream";
      return "unknown";
    default:
      return "none";
  }
}

export function classifyPlaybackFailureFromResult(result: PlaybackResult): PlaybackFailureClass {
  if (result.suspectedDeadStream) return "expired-stream";
  if (result.endReason === "error") return "player-exited";
  if (
    result.endReason === "unknown" &&
    (result.resultSource ?? "unknown") === "unknown" &&
    !result.playerExitedCleanly
  ) {
    return "player-exited";
  }
  if (result.endReason === "unknown" && result.watchedSeconds <= 0 && result.duration <= 0) {
    return "unknown";
  }
  return "none";
}

export function recoveryForPlaybackFailure(
  failureClass: PlaybackFailureClass,
): PlaybackRecoveryGuidance {
  switch (failureClass) {
    case "network-buffering":
      return {
        action: "wait",
        label: "Wait briefly; if cache speed stays flat, refresh the source.",
      };
    case "expired-stream":
      return {
        action: "refresh",
        label: "Refresh the provider source; the HLS URL or segment lease may have expired.",
      };
    case "seek-stuck":
      return {
        action: "refresh",
        label: "Refresh the current source from the saved position.",
      };
    case "ipc-stuck":
      return {
        action: "relaunch",
        label: "Stop and relaunch mpv; control IPC stopped responding.",
      };
    case "player-exited":
      return {
        action: "relaunch",
        label:
          "Relaunch mpv from the last trusted position; try another provider only if relaunch fails.",
      };
    case "unknown":
      return {
        action: "inspect",
        label:
          "Open diagnostics, press Ctrl+r in mpv to refresh the stream, or rerun with --mpv-debug/--mpv-clean.",
      };
    case "none":
      return { action: "none", label: "No recovery needed." };
  }
}
