import type { StreamInfo } from "@/domain/types";

/** Aligns with `stream-manifest` SQLite TTL and stream-health `playbackTrustMs`. */
export const MAX_IN_MEMORY_STREAM_REPLAY_AGE_MS = 5 * 60_000;

export function isStreamTimestampFresh(
  stream: Pick<StreamInfo, "timestamp">,
  now: number = Date.now(),
): boolean {
  const timestamp = stream.timestamp;
  if (!timestamp || timestamp <= 0) return false;
  return now - timestamp <= MAX_IN_MEMORY_STREAM_REPLAY_AGE_MS;
}
