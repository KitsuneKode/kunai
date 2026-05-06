import type { PlayerTelemetrySample } from "./mpv-telemetry";
import type { PlayerPlaybackEvent } from "./PlayerService";

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
    cacheStallAfterMs?: number;
    networkReadDeadAfterMs?: number;
    networkSampleEveryMs?: number;
  },
): PlaybackWatchdog {
  const intervalMs = options?.intervalMs ?? 2_500;
  const stallAfterMs = options?.stallAfterMs ?? 12_000;
  const seekStallAfterMs = options?.seekStallAfterMs ?? 8_000;
  const cacheStallAfterMs = options?.cacheStallAfterMs ?? 20_000;
  /** Demuxer reports underrun + zero read rate while waiting for cache (see mpv demuxer-cache-state). */
  const networkReadDeadAfterMs = options?.networkReadDeadAfterMs ?? 8_000;
  const networkSampleEveryMs = options?.networkSampleEveryMs ?? 2_500;
  let latest: PlayerTelemetrySample | null = null;
  let lastPosition = 0;
  let lastProgressAt = Date.now();
  let lastCacheAheadSeconds = 0;
  let lastCacheProgressAt = Date.now();
  let seekingSince: number | null = null;
  let emittedStreamStall = false;
  let emittedSeekStall = false;
  let pausedOrIdle = false;
  let networkReadDeadSince: number | null = null;
  let emittedNetworkReadDead = false;
  let lastNetworkSampleAt = 0;

  const resetProgressClock = (observedAt: number, positionSeconds: number) => {
    lastPosition = positionSeconds;
    lastProgressAt = observedAt;
    lastCacheProgressAt = observedAt;
    emittedStreamStall = false;
  };

  const timer = setInterval(() => {
    if (!latest) return;

    const now = Date.now();
    const userPausedOrIdle = Boolean(latest.paused || latest.idleActive || latest.coreIdle);

    if (userPausedOrIdle) {
      pausedOrIdle = true;
      resetProgressClock(now, latest.positionSeconds);
      seekingSince = null;
      emittedSeekStall = false;
      networkReadDeadSince = null;
      emittedNetworkReadDead = false;
      return;
    }

    if (pausedOrIdle) {
      pausedOrIdle = false;
      resetProgressClock(now, latest.positionSeconds);
      seekingSince = null;
      emittedSeekStall = false;
      networkReadDeadSince = null;
      emittedNetworkReadDead = false;
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

    if (latest.pausedForCache) {
      const rawRate = latest.demuxerRawInputRate;
      const networkReadDead =
        latest.demuxerViaNetwork === true && latest.demuxerCacheUnderrun === true && rawRate === 0;

      if (networkReadDead) {
        networkReadDeadSince ??= now;
        const deadForMs = now - networkReadDeadSince;
        if (deadForMs >= networkReadDeadAfterMs && !emittedNetworkReadDead) {
          emittedNetworkReadDead = true;
          emittedStreamStall = true;
          emit({
            type: "stream-stalled",
            secondsWithoutProgress: Math.round(deadForMs / 1000),
            stallKind: "network-read-dead",
          });
        }
      } else {
        networkReadDeadSince = null;
        emittedNetworkReadDead = false;
      }

      const cacheAhead = latest.demuxerCacheDurationSeconds ?? 0;
      const cacheSpeed = latest.cacheSpeedBytesPerSecond ?? 0;
      if (cacheAhead > lastCacheAheadSeconds + 0.25 || cacheSpeed > 0) {
        lastCacheProgressAt = now;
        emittedStreamStall = false;
      }
      lastCacheAheadSeconds = cacheAhead;

      const cacheStalledForMs = now - lastCacheProgressAt;
      if (cacheStalledForMs >= cacheStallAfterMs && !emittedStreamStall) {
        emittedStreamStall = true;
        emit({
          type: "stream-stalled",
          secondsWithoutProgress: Math.round(cacheStalledForMs / 1000),
        });
      }
      return;
    }

    networkReadDeadSince = null;
    emittedNetworkReadDead = false;

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
      if (
        sample.demuxerViaNetwork === true &&
        sample.observedAt - lastNetworkSampleAt >= networkSampleEveryMs
      ) {
        lastNetworkSampleAt = sample.observedAt;
        emit({
          type: "network-sample",
          cacheAheadSeconds: sample.demuxerCacheDurationSeconds,
          cacheSpeed: sample.cacheSpeedBytesPerSecond,
          rawInputRate: sample.demuxerRawInputRate,
          demuxerViaNetwork: sample.demuxerViaNetwork,
          pausedForCache: sample.pausedForCache,
          underrun: sample.demuxerCacheUnderrun,
        });
      }

      if (sample.positionSeconds > lastPosition + 0.25) {
        lastPosition = sample.positionSeconds;
        lastProgressAt = sample.observedAt;
        lastCacheProgressAt = sample.observedAt;
        emittedStreamStall = false;
        networkReadDeadSince = null;
        emittedNetworkReadDead = false;
      }

      const userPausedOrIdle = Boolean(sample.paused || sample.idleActive || sample.coreIdle);
      if (userPausedOrIdle) {
        pausedOrIdle = true;
        resetProgressClock(sample.observedAt, sample.positionSeconds);
      }

      if (sample.pausedForCache) {
        const cacheAhead = sample.demuxerCacheDurationSeconds ?? 0;
        const cacheSpeed = sample.cacheSpeedBytesPerSecond ?? 0;
        if (cacheAhead > lastCacheAheadSeconds + 0.25 || cacheSpeed > 0) {
          lastCacheProgressAt = sample.observedAt;
        }
        lastCacheAheadSeconds = cacheAhead;

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
