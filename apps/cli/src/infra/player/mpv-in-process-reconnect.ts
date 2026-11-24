import type { PlayerPlaybackEvent } from "./PlayerService";

/** Why a persistent mpv session reloads the same URL in place. */
export type InProcessReconnectTrigger =
  | "network-read-dead"
  | "video-lost"
  | "premature-eof"
  | "error";

/**
 * Watchdog stalls answered by reloading the same URL while the old file is
 * still loaded. `video-lost` (frames stopped while the clock runs) reloads to
 * re-initialise the decoder at the same position.
 */
export type WatchdogReconnectTrigger = Extract<
  InProcessReconnectTrigger,
  "network-read-dead" | "video-lost"
>;

export function isWatchdogReconnectTrigger(
  trigger: string | undefined,
): trigger is WatchdogReconnectTrigger {
  return trigger === "network-read-dead" || trigger === "video-lost";
}

export function watchdogReconnectTrigger(
  event: PlayerPlaybackEvent,
): WatchdogReconnectTrigger | null {
  if (event.type !== "stream-stalled") return null;
  return isWatchdogReconnectTrigger(event.stallKind) ? event.stallKind : null;
}

/**
 * Same-URL in-process stream reload (persistent mpv): seek policy after `loadfile`.
 * When duration is unknown (≤0), we reload only — typical live / open-ended HLS.
 */
export function computeInProcessReconnectSeek(
  positionSeconds: number,
  durationSeconds: number,
): { seekSeconds: number; shouldSeek: boolean } {
  const pos = Math.max(0, positionSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { seekSeconds: pos, shouldSeek: false };
  }
  const seekSeconds = Math.min(pos, Math.max(durationSeconds - 0.5, 0));
  return { seekSeconds, shouldSeek: seekSeconds >= 0.25 };
}
