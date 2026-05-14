export type PlaybackTelemetrySnapshot = {
  readonly positionSeconds?: number;
  readonly durationSeconds?: number;
  readonly cacheAheadSeconds?: number;
  readonly cacheSpeedBytesPerSecond?: number;
  readonly bufferingPercent?: number;
  readonly seeking?: boolean;
  readonly pausedForCache?: boolean;
  readonly voConfigured?: boolean;
  readonly updatedAt: number;
};

export function describePlaybackTelemetrySnapshot(snapshot: PlaybackTelemetrySnapshot): string {
  const parts: string[] = [];

  if (
    typeof snapshot.positionSeconds === "number" &&
    Number.isFinite(snapshot.positionSeconds) &&
    typeof snapshot.durationSeconds === "number" &&
    Number.isFinite(snapshot.durationSeconds) &&
    snapshot.durationSeconds > 0
  ) {
    parts.push(
      `${formatPlaybackTime(snapshot.positionSeconds)} / ${formatPlaybackTime(snapshot.durationSeconds)}`,
    );
  }

  if (
    typeof snapshot.cacheAheadSeconds === "number" &&
    Number.isFinite(snapshot.cacheAheadSeconds) &&
    snapshot.cacheAheadSeconds > 0
  ) {
    parts.push(`${(Math.round(snapshot.cacheAheadSeconds * 10) / 10).toFixed(1)}s cached`);
  }

  if (
    typeof snapshot.cacheSpeedBytesPerSecond === "number" &&
    Number.isFinite(snapshot.cacheSpeedBytesPerSecond) &&
    snapshot.cacheSpeedBytesPerSecond > 0
  ) {
    parts.push(`${(snapshot.cacheSpeedBytesPerSecond / 1_000_000).toFixed(1)} MB/s`);
  }

  if (typeof snapshot.bufferingPercent === "number" && Number.isFinite(snapshot.bufferingPercent)) {
    parts.push(`buffering ${Math.round(snapshot.bufferingPercent)}%`);
  }

  if (snapshot.seeking) {
    parts.push("seeking");
  }

  if (snapshot.voConfigured === false) {
    parts.push("video output pending");
  }

  return parts.join(" · ") || "telemetry pending";
}

function formatPlaybackTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
