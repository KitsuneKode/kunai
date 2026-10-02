import type { PlayerStatsSample } from "./mpv-stats";
import type { PlayerPlaybackEvent } from "./PlayerService";

export interface PlaybackWatchdog {
  observe(sample: PlayerStatsSample): void;
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
    slowNetworkAfterMs?: number;
    slowOpenAfterMs?: number;
  },
): PlaybackWatchdog {
  const intervalMs = options?.intervalMs ?? 2_500;
  const stallAfterMs = options?.stallAfterMs ?? 12_000;
  const seekStallAfterMs = options?.seekStallAfterMs ?? 8_000;
  const cacheStallAfterMs = options?.cacheStallAfterMs ?? 20_000;
  /** Demuxer reports underrun + zero read rate while waiting for cache (see mpv demuxer-cache-state). */
  const networkReadDeadAfterMs = options?.networkReadDeadAfterMs ?? 8_000;
  const networkSampleEveryMs = options?.networkSampleEveryMs ?? 2_500;
  const slowNetworkAfterMs = options?.slowNetworkAfterMs ?? 6_000;
  /**
   * Before the position has ever advanced there is nothing to stall on — a
   * slow open (redirects, TLS, manifest fetch, first segment) legitimately
   * reports zero movement. The startup watchdog owns the real abort call; this
   * softer threshold only narrates "still opening" so the surface stays honest.
   */
  const slowOpenAfterMs = options?.slowOpenAfterMs ?? 15_000;
  let latest: PlayerStatsSample | null = null;
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
  let bufferingSince: number | null = null;
  let emittedSlowNetwork = false;
  let lastNetworkSampleAt = 0;
  /** Position has demonstrably advanced (or loaded to a nonzero start). */
  let hasSeenProgress = false;
  let lastSlowOpenSecond = -1;

  const emitSlowOpen = (elapsedMs: number, cacheSample: PlayerStatsSample) => {
    const second = Math.floor(elapsedMs / 1000);
    if (elapsedMs < slowOpenAfterMs || second === lastSlowOpenSecond) return;
    lastSlowOpenSecond = second;
    emit({
      type: "stream-slow",
      state: "slow-open",
      secondsBuffering: Math.round(elapsedMs / 1000),
      cacheAheadSeconds: cacheSample.demuxerCacheDurationSeconds,
      cacheSpeed: cacheSample.cacheSpeedBytesPerSecond,
    });
  };

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
      bufferingSince = null;
      emittedSlowNetwork = false;
      return;
    }

    if (pausedOrIdle) {
      pausedOrIdle = false;
      resetProgressClock(now, latest.positionSeconds);
      seekingSince = null;
      emittedSeekStall = false;
      networkReadDeadSince = null;
      emittedNetworkReadDead = false;
      bufferingSince = null;
      emittedSlowNetwork = false;
    }

    if (latest.seeking) {
      seekingSince ??= now;
      const seekingForMs = now - seekingSince;
      if (!hasSeenProgress) {
        // The opening seek (startAt resume) runs inside stream open and can
        // legitimately take a while on slow sources — narrate the open, don't
        // cry stall. The clock is the open, not the seek.
        emitSlowOpen(now - lastProgressAt, latest);
        return;
      }
      if (seekingForMs >= seekStallAfterMs && !emittedSeekStall) {
        emittedSeekStall = true;
        emit({ type: "seek-stalled", secondsSeeking: Math.round(seekingForMs / 1000) });
      }
      return;
    }

    seekingSince = null;
    emittedSeekStall = false;

    if (latest.pausedForCache) {
      bufferingSince ??= now;
      const bufferingForMs = now - bufferingSince;
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

      if (bufferingForMs >= slowNetworkAfterMs && !emittedSlowNetwork && !emittedNetworkReadDead) {
        emittedSlowNetwork = true;
        emit({
          type: "stream-slow",
          state: "slow-network-suspected",
          secondsBuffering: Math.round(bufferingForMs / 1000),
          cacheAheadSeconds: latest.demuxerCacheDurationSeconds,
          cacheSpeed: latest.cacheSpeedBytesPerSecond,
        });
      }

      const cacheStalledForMs = now - lastCacheProgressAt;
      if (cacheStalledForMs >= cacheStallAfterMs && !emittedStreamStall) {
        emittedStreamStall = true;
        emit({
          type: "stream-stalled",
          secondsWithoutProgress: Math.round(cacheStalledForMs / 1000),
          stallKind: "cache-starved",
        });
      }
      return;
    }

    networkReadDeadSince = null;
    emittedNetworkReadDead = false;
    bufferingSince = null;
    emittedSlowNetwork = false;

    const stalledForMs = now - lastProgressAt;
    if (!hasSeenProgress) {
      // Position has never advanced: this is the open phase, not a stall.
      // Claiming "stream stalled" here is how a slow-but-healthy connect gets
      // misread as a dead stream — the startup watchdog owns that call.
      emitSlowOpen(stalledForMs, latest);
      return;
    }
    if (stalledForMs >= stallAfterMs && !emittedStreamStall) {
      emittedStreamStall = true;
      emit({
        type: "stream-stalled",
        secondsWithoutProgress: Math.round(stalledForMs / 1000),
        stallKind: "no-progress",
      });
    }
  }, intervalMs);

  return {
    observe(sample) {
      const wasSeeking = Boolean(latest?.seeking);
      latest = sample;
      if (!wasSeeking && sample.seeking) {
        emittedStreamStall = false;
      }
      if (wasSeeking && !sample.seeking) {
        lastProgressAt = sample.observedAt;
        lastCacheProgressAt = sample.observedAt;
        emittedStreamStall = false;
      }
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

      // A new loadfile in the same process rewinds position to ~0 — that is a
      // fresh open, not progress backward. Re-arm the startup gate so the next
      // title's slow open isn't judged by mid-playback rules.
      if (hasSeenProgress && lastPosition > 0.25 && sample.positionSeconds < 0.25) {
        hasSeenProgress = false;
        lastSlowOpenSecond = -1;
        lastPosition = sample.positionSeconds;
        lastProgressAt = sample.observedAt;
        lastCacheProgressAt = sample.observedAt;
        emittedStreamStall = false;
        seekingSince = null;
        emittedSeekStall = false;
        networkReadDeadSince = null;
        emittedNetworkReadDead = false;
        bufferingSince = null;
        emittedSlowNetwork = false;
      }

      if (sample.positionSeconds > lastPosition + 0.25) {
        hasSeenProgress = true;
        lastPosition = sample.positionSeconds;
        lastProgressAt = sample.observedAt;
        lastCacheProgressAt = sample.observedAt;
        emittedStreamStall = false;
        networkReadDeadSince = null;
        emittedNetworkReadDead = false;
        bufferingSince = null;
        emittedSlowNetwork = false;
      }

      const userPausedOrIdle = Boolean(sample.paused || sample.idleActive || sample.coreIdle);
      if (userPausedOrIdle) {
        pausedOrIdle = true;
        resetProgressClock(sample.observedAt, sample.positionSeconds);
      }

      if (sample.pausedForCache) {
        bufferingSince ??= sample.observedAt;
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
        // Once the slow-network warning fired it is the stronger signal —
        // keep ticking percent updates, but don't let the milder counter
        // overwrite it on the same feedback slot.
        if (!emittedSlowNetwork) {
          emit({
            type: "stream-slow",
            state: "buffering-observed",
            secondsBuffering: Math.max(0, Math.round((sample.observedAt - bufferingSince) / 1000)),
            cacheAheadSeconds: sample.demuxerCacheDurationSeconds,
            cacheSpeed: sample.cacheSpeedBytesPerSecond,
          });
        }
      }
    },
    stop() {
      clearInterval(timer);
    },
  };
}
