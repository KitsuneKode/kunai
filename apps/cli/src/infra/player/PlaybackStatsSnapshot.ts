import type { PlaybackStatsSnapshot } from "@/domain/playback/playback-stats-snapshot";

import type { PlayerStatsState } from "./mpv-stats";

export type { PlaybackStatsSnapshot } from "@/domain/playback/playback-stats-snapshot";

export function buildPlaybackStatsSnapshot(state: PlayerStatsState): PlaybackStatsSnapshot | null {
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
