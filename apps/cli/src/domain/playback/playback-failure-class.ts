/**
 * What a player session failed as. Infra classifiers map events and results
 * into this union; the shell switches on it for copy. A missing case is a
 * type error at every exhaustive switch.
 */
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

export function isPlaybackFailureClass(value: string): value is PlaybackFailureClass {
  switch (value) {
    case "none":
    case "network-buffering":
    case "slow-stream":
    case "expired-stream":
    case "seek-stuck":
    case "ipc-stuck":
    case "player-exited":
    case "video-not-decoding":
    case "video-lost":
    case "unknown":
      return true;
    default:
      return false;
  }
}

/** True when the class is evidence the user should see a recovery action. */
export function playbackFailureNeedsAttention(failureClass: PlaybackFailureClass): boolean {
  switch (failureClass) {
    case "none":
      return false;
    case "network-buffering":
    case "slow-stream":
    case "expired-stream":
    case "seek-stuck":
    case "ipc-stuck":
    case "player-exited":
    case "video-not-decoding":
    case "video-lost":
    case "unknown":
      return true;
  }
}
