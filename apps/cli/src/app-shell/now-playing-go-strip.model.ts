import { contentKindHasEpisodes, type ContentKind } from "@/domain/media/content-kind";
import type { PlayerCapabilities } from "@/domain/playback/player-capabilities";
import type { PlaybackTimingMetadata, PlaybackTimingSegment } from "@/domain/types";

import { fitTextItemsOnOneLine, footerRowBudget } from "./footer-width";
import { footerKeyFromBinding, KEYBINDINGS, type KeyBinding } from "./keybindings";
import { measureColumns } from "./shell-text";

const PREFIX = "GO  ";
const SEPARATOR = " · ";

/**
 * Manual `b` seeks only while the playhead sits inside a timed window.
 * Same window as `findPlaybackSegmentAtPosition` in the player: a chip that
 * appears here is a key the playing screen will actually seek.
 */
export function playbackHasSkippableSegment(
  timing: PlaybackTimingMetadata | null | undefined,
  positionSeconds: number | undefined,
): boolean {
  if (!timing || positionSeconds === undefined || !Number.isFinite(positionSeconds)) return false;
  if (positionSeconds < 0.5) return false;
  const groups = [timing.recap, timing.intro, timing.preview, timing.credits];
  for (const group of groups) {
    if (segmentContains(group, positionSeconds)) return true;
  }
  return false;
}

function segmentContains(
  segments: readonly PlaybackTimingSegment[] | undefined,
  positionSeconds: number,
): boolean {
  for (const segment of segments ?? []) {
    const startMs = segment.startMs;
    const start = startMs === null || !Number.isFinite(startMs) || startMs < 0 ? 0 : startMs / 1000;
    const endMs = segment.endMs;
    if (endMs === null || !Number.isFinite(endMs) || endMs <= 0) continue;
    const end = endMs / 1000;
    if (end <= start) continue;
    if (positionSeconds >= start && positionSeconds < end - 0.25) return true;
  }
  return false;
}

export type NowPlayingGoStripInput = {
  readonly contentKind?: ContentKind;
  readonly titleType?: import("@/domain/types").ContentType;
  readonly hasNextEpisode: boolean;
  readonly hasPreviousEpisode: boolean;
  /** Playhead is inside a timed intro, recap, preview, or credits window. */
  readonly hasSkippableSegment: boolean;
  /** `o` opens the tracks picker on this screen. */
  readonly canOpenTracks: boolean;
  readonly capabilities: PlayerCapabilities;
  /** Column budget of the deck line, including the `GO` prefix. */
  readonly width: number;
  readonly bindings?: readonly KeyBinding[];
};

export type NowPlayingGoStripModel = {
  readonly line: string;
  readonly limitation: string | null;
};

type ChipId =
  | "player-episode"
  | "player-next"
  | "player-previous"
  | "player-skip"
  | "player-source";

/**
 * Scan order on the deck. The tail is lowest priority and drops first when
 * the row cannot fit. Keys come from the player-scope registry.
 */
const CHIP_ORDER: readonly ChipId[] = [
  "player-next",
  "player-previous",
  "player-skip",
  "player-episode",
  "player-source",
];

function chipKey(binding: KeyBinding): string {
  const input = binding.chord.input;
  if (input && !binding.chord.ctrl && !binding.chord.meta && !binding.chord.shift) {
    return input.toLowerCase();
  }
  return footerKeyFromBinding(binding).split(" / ")[0] ?? "";
}

function chipLabel(id: ChipId, binding: KeyBinding): string {
  if (id === "player-source") return "tracks";
  if (id === "player-skip") return binding.hintLabel ?? "skip";
  return binding.hintLabel ?? binding.label;
}

/**
 * One line instead of a control the player cannot perform. VLC is managed
 * playback with `trackControl: false`; a detached handoff cannot seek or
 * switch tracks from this deck at all.
 */
export function nowPlayingCapabilityLine(capabilities: PlayerCapabilities): string | null {
  if (capabilities.observation === "detached") {
    return "Controls are in the external player";
  }
  if (!capabilities.trackControl) return "Track switches need mpv";
  return null;
}

export function buildNowPlayingGoStrip(input: NowPlayingGoStripInput): NowPlayingGoStripModel {
  const limitation = nowPlayingCapabilityLine(input.capabilities);
  if (input.capabilities.observation === "detached") {
    return { line: "", limitation };
  }

  const episodic = contentKindHasEpisodes(input.contentKind, input.titleType);
  const included = (id: ChipId): boolean => {
    switch (id) {
      case "player-next":
        return episodic && input.hasNextEpisode;
      case "player-previous":
        return episodic && input.hasPreviousEpisode;
      case "player-skip":
        return input.hasSkippableSegment && input.capabilities.autoSkip;
      case "player-episode":
        return episodic;
      case "player-source":
        return input.canOpenTracks && input.capabilities.trackControl;
    }
  };

  const bindings = input.bindings ?? KEYBINDINGS;
  const byId = new Map(bindings.map((binding) => [binding.id, binding]));
  const chips: string[] = [];
  for (const id of CHIP_ORDER) {
    if (!included(id)) continue;
    const binding = byId.get(id);
    if (!binding || binding.helpOnly) continue;
    const key = chipKey(binding);
    if (!key) continue;
    chips.push(`${key} ${chipLabel(id, binding)}`);
  }

  const prefixColumns = measureColumns(PREFIX);
  const fitted = fitTextItemsOnOneLine(
    chips,
    Math.max(0, footerRowBudget(input.width) - prefixColumns),
    SEPARATOR,
  );

  return {
    line: fitted.length > 0 ? `${PREFIX}${fitted.join(SEPARATOR)}` : "",
    limitation,
  };
}
