import type { PlaybackTelemetrySnapshot } from "@/domain/playback/playback-telemetry-snapshot";

import type { PlayerTelemetryState } from "./mpv-telemetry";

export type { PlaybackTelemetrySnapshot } from "@/domain/playback/playback-telemetry-snapshot";

export function buildPlaybackTelemetrySnapshot(
  state: PlayerTelemetryState,
): PlaybackTelemetrySnapshot | null {
  const sample = state.latestIpcSample;
  if (!sample) return null;

  return {
    positionSeconds: sample.positionSeconds,
    durationSeconds: sample.durationSeconds,
    cacheAheadSeconds: sample.demuxerCacheDurationSeconds,
    cacheSpeedBytesPerSecond: sample.cacheSpeedBytesPerSecond,
    bufferingPercent: sample.cacheBufferingState,
    seeking: sample.seeking,
    pausedForCache: sample.pausedForCache,
    voConfigured: sample.voConfigured,
    updatedAt: sample.observedAt,
  };
}
