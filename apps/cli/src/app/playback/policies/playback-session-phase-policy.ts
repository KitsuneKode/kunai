import type {
  PlaybackSessionPhase,
  PlaybackSessionPhaseEvent,
} from "@/app/playback/playback-session-controller";

export function playbackSessionPhaseForEvent(
  event: PlaybackSessionPhaseEvent,
): PlaybackSessionPhase {
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
