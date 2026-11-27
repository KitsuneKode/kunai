import goPng from "./brand/pets/go.png" with { type: "file" };
import goStrip from "./brand/pets/go.strip.png" with { type: "file" };
import idlePng from "./brand/pets/idle.png" with { type: "file" };
import idleStrip from "./brand/pets/idle.strip.png" with { type: "file" };
import motion from "./brand/pets/motion.json";
import napPng from "./brand/pets/nap.png" with { type: "file" };
import napStrip from "./brand/pets/nap.strip.png" with { type: "file" };
import oopsPng from "./brand/pets/oops.png" with { type: "file" };
import oopsStrip from "./brand/pets/oops.strip.png" with { type: "file" };
import peekPng from "./brand/pets/peek.png" with { type: "file" };
import peekStrip from "./brand/pets/peek.strip.png" with { type: "file" };
import seekPng from "./brand/pets/seek.png" with { type: "file" };
import seekStrip from "./brand/pets/seek.strip.png" with { type: "file" };
import waitPng from "./brand/pets/wait.png" with { type: "file" };
import waitStrip from "./brand/pets/wait.strip.png" with { type: "file" };
import watchPng from "./brand/pets/watch.png" with { type: "file" };
import watchStrip from "./brand/pets/watch.strip.png" with { type: "file" };
import type { CompanionPose } from "./companion-policy";

/**
 * Every pose ships twice: the still every image-capable terminal draws, and the
 * strip of drawings a terminal that animates plays. Both are file assets —
 * embedded in the compiled binary, never inlined into the JS bundle — so the
 * art costs the startup bundle a path string each.
 */
const PET_FILES = {
  idle: { still: idlePng, strip: idleStrip },
  wait: { still: waitPng, strip: waitStrip },
  seek: { still: seekPng, strip: seekStrip },
  go: { still: goPng, strip: goStrip },
  watch: { still: watchPng, strip: watchStrip },
  oops: { still: oopsPng, strip: oopsStrip },
  nap: { still: napPng, strip: napStrip },
  peek: { still: peekPng, strip: peekStrip },
} satisfies Record<CompanionPose, { still: string; strip: string }>;

/** Filesystem or `/$bunfs/` path; `Bun.file()` reads both. */
export function companionPetPath(pose: CompanionPose): string {
  return PET_FILES[pose].still;
}

/** The pose's drawings side by side, `rest` first. */
export function companionStripPath(pose: CompanionPose): string {
  return PET_FILES[pose].strip;
}

export type CompanionMotion = {
  /** How many drawings the strip holds. */
  readonly frames: number;
  /** The loop: which drawing, and how many milliseconds it holds. */
  readonly loop: readonly (readonly [frame: number, gapMs: number])[];
};

const MOTION: Record<CompanionPose, { frames: number; loop: number[][] }> = motion.poses;

/**
 * What a pose does when the terminal animates her. Written by the same export
 * that cuts the strip, so the drawing count and the loop cannot disagree.
 */
export function companionMotion(pose: CompanionPose): CompanionMotion {
  const { frames, loop } = MOTION[pose];
  return { frames, loop: loop.map(([frame = 0, gapMs = 0]) => [frame, gapMs] as const) };
}
