import type { PlaybackTimingMetadata } from "@/domain/types";

import {
  findActivePlaybackSkip,
  findPlaybackSegmentAtPosition,
  playbackSkipConfig,
  pruneSkippedPlaybackSegmentKeys,
  type ActivePlaybackSkip,
  type PlaybackSkipOptions,
} from "../playback-skip";

/**
 * Intro, recap and credits skipping for VLC, decided by the same functions
 * mpv uses (`playback-skip.ts`). VLC has no Kunai overlay to show a prompt, so
 * this is mpv's instant path: inside an enabled segment, seek to its end once.
 * A backward seek re-arms segments still ahead, as it does in mpv.
 */
export type VlcSkipTracker = {
  readonly timing: () => PlaybackTimingMetadata | null;
  readonly setTiming: (timing: PlaybackTimingMetadata | null) => void;
  readonly setAutoSkipEnabled: (enabled: boolean) => void;
  /** The segment to skip now, already marked done; null when there is none. */
  readonly observe: (positionSeconds: number) => ActivePlaybackSkip | null;
  /** The user's skip key: the segment under the playhead whatever the toggles, once. */
  readonly manual: () => ActivePlaybackSkip | null;
};

/** Small jitter between polls is not a seek; only a real step back re-arms. */
const BACKWARD_SEEK_SECONDS = 0.5;

export function createVlcSkipTracker(
  initial: PlaybackSkipOptions & { readonly timing?: PlaybackTimingMetadata | null },
): VlcSkipTracker {
  let timing = initial.timing ?? null;
  let options: PlaybackSkipOptions = initial;
  let skipped = new Set<string>();
  let lastPosition: number | null = null;

  const take = (segment: ActivePlaybackSkip | null): ActivePlaybackSkip | null => {
    if (!segment || skipped.has(segment.key)) return null;
    skipped.add(segment.key);
    return segment;
  };

  return {
    timing: () => timing,
    setTiming: (next) => {
      timing = next;
    },
    setAutoSkipEnabled: (enabled) => {
      options = { ...options, autoSkipEnabled: enabled };
    },
    observe: (positionSeconds) => {
      if (lastPosition !== null && positionSeconds + BACKWARD_SEEK_SECONDS < lastPosition) {
        skipped = pruneSkippedPlaybackSegmentKeys(skipped, timing, positionSeconds);
      }
      lastPosition = positionSeconds;
      return take(findActivePlaybackSkip(timing, positionSeconds, playbackSkipConfig(options)));
    },
    manual: () =>
      lastPosition === null ? null : take(findPlaybackSegmentAtPosition(timing, lastPosition)),
  };
}

/**
 * VLC lands a fractional `seek` on a whole second (measured, VLC 3.0.24), so
 * Kunai picks the second: the nearest one, at most half a second either side.
 */
export function vlcSeekTarget(endSeconds: number): number {
  return Math.max(0, Math.round(endSeconds));
}
