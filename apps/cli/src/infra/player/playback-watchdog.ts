import type { PlayerPlaybackEvent } from "./PlayerService";
import type { PlayerTelemetrySample } from "./mpv-telemetry";

export interface PlaybackWatchdog {
  observe(sample: PlayerTelemetrySample): void;
  stop(): void;
}

export function createPlaybackWatchdog(
  emit: (event: PlayerPlaybackEvent) => void,
  options?: {
    intervalMs?: number;
    stallAfterMs?: number;
    seekStallAfterMs?: number;
  },
): PlaybackWatchdog {
  const intervalMs = options?.intervalMs ?? 2_500;
  const stallAfterMs = options?.stallAfterMs ?? 12_000;
  const seekStallAfterMs = options?.seekStallAfterMs ?? 8_000;
  let latest: PlayerTelemetrySample | null = null;
  let lastPosition = 0;
  let lastProgressAt = Date.now();
  let seekingSince: number | null = null;
  let emittedStreamStall = false;
  let emittedSeekStall = false;

  const timer = setInterval(() => {
    if (!latest) return;

    const now = Date.now();
    if (latest.paused || latest.pausedForCache || latest.idleActive || latest.coreIdle) {
      return;
    }

    if (latest.seeking) {
      seekingSince ??= now;
      const seekingForMs = now - seekingSince;
      if (seekingForMs >= seekStallAfterMs && !emittedSeekStall) {
        emittedSeekStall = true;
        emit({ type: "seek-stalled", secondsSeeking: Math.round(seekingForMs / 1000) });
      }
      return;
    }

    seekingSince = null;
    emittedSeekStall = false;

    const stalledForMs = now - lastProgressAt;
    if (stalledForMs >= stallAfterMs && !emittedStreamStall) {
      emittedStreamStall = true;
      emit({
        type: "stream-stalled",
        secondsWithoutProgress: Math.round(stalledForMs / 1000),
      });
    }
  }, intervalMs);

  return {
    observe(sample) {
      latest = sample;
      if (sample.positionSeconds > lastPosition + 0.25) {
        lastPosition = sample.positionSeconds;
        lastProgressAt = sample.observedAt;
        emittedStreamStall = false;
      }

      if (sample.pausedForCache) {
        emit({
          type: "network-buffering",
          percent: sample.cacheBufferingState,
          cacheAheadSeconds: sample.demuxerCacheDurationSeconds,
          cacheSpeed: sample.cacheSpeedBytesPerSecond,
        });
      }
    },
    stop() {
      clearInterval(timer);
    },
  };
}
