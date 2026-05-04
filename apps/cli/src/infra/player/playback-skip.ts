import type { PlaybackTimingMetadata, PlaybackTimingSegment } from "@/domain/types";

export type PlaybackSkipKind = "recap" | "intro" | "preview" | "credits";

export interface PlaybackSkipConfig {
  readonly skipRecap: boolean;
  readonly skipIntro: boolean;
  readonly skipPreview: boolean;
  readonly skipCredits: boolean;
  readonly autoNextEnabled: boolean;
}

export interface ActivePlaybackSkip {
  readonly kind: PlaybackSkipKind;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly key: string;
}

type SegmentGroup = readonly [PlaybackSkipKind, readonly PlaybackTimingSegment[]];

function normalizeStartSeconds(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value / 1000;
}

function normalizeEndSeconds(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value / 1000;
}

function segmentGroups(timing: PlaybackTimingMetadata | null | undefined): readonly SegmentGroup[] {
  if (!timing) return [];
  return [
    ["recap", timing.recap],
    ["intro", timing.intro],
    ["preview", timing.preview],
    ["credits", timing.credits],
  ] as const;
}

export function isPlaybackAutoSkipEnabled(
  kind: PlaybackSkipKind,
  config: PlaybackSkipConfig,
): boolean {
  switch (kind) {
    case "recap":
      return config.skipRecap;
    case "intro":
      return config.skipIntro;
    case "preview":
      return config.skipPreview;
    case "credits":
      // hybrid: skip credits when the toggle is on OR autoNext is active
      return config.skipCredits || config.autoNextEnabled;
  }
}

/**
 * First timed segment that contains `positionSeconds`, ignoring user skip toggles.
 * Used for mpv skip prompts (manual offer + `i` / click target) even when auto-skip is off.
 */
export function findPlaybackSegmentAtPosition(
  timing: PlaybackTimingMetadata | null | undefined,
  positionSeconds: number,
): ActivePlaybackSkip | null {
  if (!timing || !Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return null;
  }

  for (const [kind, segments] of segmentGroups(timing)) {
    for (const segment of segments) {
      const startSeconds = normalizeStartSeconds(segment.startMs);
      const endSeconds = normalizeEndSeconds(segment.endMs);
      if (endSeconds === null || endSeconds <= startSeconds) {
        continue;
      }
      if (positionSeconds >= startSeconds && positionSeconds < endSeconds - 0.25) {
        return {
          kind,
          startSeconds,
          endSeconds,
          key: `${kind}:${startSeconds}:${endSeconds}`,
        };
      }
    }
  }

  return null;
}

export function playbackSkipKindLabel(kind: PlaybackSkipKind): string {
  switch (kind) {
    case "intro":
      return "SKIP INTRO";
    case "recap":
      return "SKIP RECAP";
    case "credits":
      return "SKIP CREDITS";
    case "preview":
      return "SKIP PREVIEW";
  }
}

export function findActivePlaybackSkip(
  timing: PlaybackTimingMetadata | null | undefined,
  positionSeconds: number,
  config: PlaybackSkipConfig,
): ActivePlaybackSkip | null {
  const segment = findPlaybackSegmentAtPosition(timing, positionSeconds);
  if (!segment) return null;
  if (!isPlaybackAutoSkipEnabled(segment.kind, config)) return null;
  return segment;
}
