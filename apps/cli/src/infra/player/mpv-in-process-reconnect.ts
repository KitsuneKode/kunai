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
 * mpv `file_error` values a same-URL reload cannot fix. Measured on mpv 0.42:
 * a 403, a 404, a refused connection and an unknown host all end the file
 * with "loading failed", and bytes that are not media with "unrecognized file
 * format". A connection dropped mid-file ends as `eof` instead, which the
 * premature-EOF reconnect still handles.
 */
const SAME_URL_HOPELESS_FILE_ERRORS: ReadonlySet<string> = new Set([
  "loading failed",
  "unrecognized file format",
  "no audio or video data played",
  "audio output initialization failed",
  "video output initialization failed",
  "not supported",
]);

/**
 * Whether reloading the same URL might help after an error end. Errors that
 * say the URL cannot be opened, or holds nothing mpv can play, go straight to
 * source failover instead of spending the reconnect budget and its backoff.
 *
 * Check it before both reconnect branches: `applyEndFileEvent` marks every end
 * that carries a `file_error` as a demoted premature EOF, so without this a
 * 403 was reloaded through the premature-EOF path as well.
 */
export function isSameUrlRetryWorthwhile(fileError: string | undefined): boolean {
  if (!fileError) return true;
  return !SAME_URL_HOPELESS_FILE_ERRORS.has(fileError.trim().toLowerCase());
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
