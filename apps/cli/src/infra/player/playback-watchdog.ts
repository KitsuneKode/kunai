import type { PlayerStatsSample } from "./mpv-stats";
import {
  hasDecodedVideo,
  readSelectedVideoTrack,
  VIDEO_DECODE_GRACE_SECONDS,
} from "./playback-output-gate";
import type { PlayerPlaybackEvent } from "./PlayerService";

export interface PlaybackWatchdog {
  observe(sample: PlayerStatsSample): void;
  stop(): void;
  /** A new file owns fresh samples and progress clocks. */
  reset(): void;
}

function isPlaybackInactive(sample: PlayerStatsSample): boolean {
  // core-idle also means cache starvation or restart, not a user pause.
  // Explicit pause and no loaded file are the states that stop stall clocks.
  return Boolean(sample.paused || sample.idleActive);
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
    /** Media-clock seconds without a frame, after frames had started, before `video-lost`. */
    videoLostAfterSeconds?: number;
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
  const videoLostAfterSeconds = options?.videoLostAfterSeconds ?? VIDEO_DECODE_GRACE_SECONDS;
  let latest: PlayerStatsSample | null = null;
  let hasProgress = false;
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
  // Frames that stop while the clock keeps running (audio plays on, picture
  // frozen or gone), measured in media-clock seconds since the last frame.
  let hadDecodedVideo = false;
  let videoLostAtPosition: number | null = null;
  let emittedVideoLost = false;

  const observeVideoOutput = (sample: PlayerStatsSample) => {
    if (hasDecodedVideo(sample)) {
      hadDecodedVideo = true;
      videoLostAtPosition = null;
      emittedVideoLost = false;
      return;
    }
    // Turning video off (vid=no) is a choice, and a seek or pause stops the clock.
    const videoSelected = readSelectedVideoTrack(sample.trackList)?.selected === true;
    if (!hadDecodedVideo || !videoSelected || sample.seeking || isPlaybackInactive(sample)) {
      videoLostAtPosition = null;
      return;
    }
    videoLostAtPosition ??= sample.positionSeconds;
    const secondsWithoutVideo = sample.positionSeconds - videoLostAtPosition;
    if (secondsWithoutVideo >= videoLostAfterSeconds && !emittedVideoLost) {
      emittedVideoLost = true;
      emit({
        type: "stream-stalled",
        secondsWithoutProgress: Math.round(secondsWithoutVideo),
        stallKind: "video-lost",
        duringStartup: false,
      });
    }
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
    const userPausedOrIdle = isPlaybackInactive(latest);

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
            duringStartup: !hasProgress,
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
          duringStartup: !hasProgress,
        });
      }
      return;
    }

    networkReadDeadSince = null;
    emittedNetworkReadDead = false;
    bufferingSince = null;
    emittedSlowNetwork = false;

    const stalledForMs = now - lastProgressAt;
    if (stalledForMs >= stallAfterMs && !emittedStreamStall) {
      emittedStreamStall = true;
      emit({
        type: "stream-stalled",
        secondsWithoutProgress: Math.round(stalledForMs / 1000),
        duringStartup: !hasProgress,
      });
    }
  }, intervalMs);

  return {
    observe(sample) {
      const firstSample = latest === null;
      const wasSeeking = Boolean(latest?.seeking);
      if (firstSample) resetProgressClock(sample.observedAt, sample.positionSeconds);
      latest = sample;
      observeVideoOutput(sample);
      if (!wasSeeking && sample.seeking) {
        emittedStreamStall = false;
      }
      // A seek lands somewhere new: progress is measured from there. Keeping the
      // pre-seek position made a backward seek look stalled until playback
      // passed the old position again.
      if (wasSeeking && !sample.seeking)
        resetProgressClock(sample.observedAt, sample.positionSeconds);
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

      if (!firstSample && sample.positionSeconds > lastPosition + 0.25) {
        hasProgress = true;
        lastPosition = sample.positionSeconds;
        lastProgressAt = sample.observedAt;
        lastCacheProgressAt = sample.observedAt;
        emittedStreamStall = false;
        networkReadDeadSince = null;
        emittedNetworkReadDead = false;
        bufferingSince = null;
        emittedSlowNetwork = false;
      }

      const userPausedOrIdle = isPlaybackInactive(sample);
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
        emit({
          type: "stream-slow",
          state: "buffering-observed",
          secondsBuffering: Math.max(0, Math.round((sample.observedAt - bufferingSince) / 1000)),
          cacheAheadSeconds: sample.demuxerCacheDurationSeconds,
          cacheSpeed: sample.cacheSpeedBytesPerSecond,
        });
      }
    },
    reset() {
      latest = null;
      hasProgress = false;
      resetProgressClock(Date.now(), 0);
      lastCacheAheadSeconds = 0;
      seekingSince = null;
      emittedSeekStall = false;
      pausedOrIdle = false;
      networkReadDeadSince = null;
      emittedNetworkReadDead = false;
      bufferingSince = null;
      emittedSlowNetwork = false;
      lastNetworkSampleAt = 0;
      hadDecodedVideo = false;
      videoLostAtPosition = null;
      emittedVideoLost = false;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
