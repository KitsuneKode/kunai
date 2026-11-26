import type { PlaybackResult } from "@/domain/types";

import type { PlayerPlaybackEvent } from "./PlayerService";

export type PlaybackFailureClass =
  | "none"
  | "network-buffering"
  | "slow-stream"
  | "expired-stream"
  | "seek-stuck"
  | "ipc-stuck"
  | "player-exited"
  | "video-not-decoding"
  | "video-lost"
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
    case "stream-slow":
      return event.state === "slow-network-suspected" ? "slow-stream" : "network-buffering";
    case "seek-stalled":
      return "seek-stuck";
    case "ipc-stalled":
      return "ipc-stuck";
    case "stream-stalled":
      if (event.stallKind === "network-read-dead") return "expired-stream";
      if (event.stallKind === "video-lost") return "video-lost";
      return "unknown";
    case "video-not-decoding":
      return "video-not-decoding";
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
    case "slow-stream":
      return {
        action: "wait",
        label:
          "Playback is buffering slowly. Keep waiting, or refresh the source if it keeps starving.",
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
    case "video-not-decoding":
      return {
        action: "pick-stream",
        label:
          "This stream's video doesn't decode here (often an unsupported codec). Pick another source or a lower quality.",
      };
    case "video-lost":
      return {
        action: "refresh",
        label: "Reloading the stream at this position to restart the video decoder.",
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
