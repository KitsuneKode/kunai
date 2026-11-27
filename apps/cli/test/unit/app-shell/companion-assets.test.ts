import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  COMPANION_ART_SIZE,
  companionMotion,
  companionPetPath,
  companionStripPath,
} from "@/app-shell/companion-assets";
import type { CompanionPose } from "@/app-shell/companion-policy";

const POSES: readonly CompanionPose[] = [
  "idle",
  "wait",
  "seek",
  "go",
  "watch",
  "oops",
  "nap",
  "peek",
];

/** Width, height and colour type straight from a PNG's IHDR — no decoder. */
function pngHeader(file: string) {
  const bytes = readFileSync(file);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25] ?? -1,
  };
}

describe("companion assets", () => {
  test("every pose ships a still at the art size, with real alpha", () => {
    for (const pose of POSES) {
      // Colour type 6 is truecolour with per-pixel alpha. A palette PNG keeps
      // a two-level mask, and on a terminal the background is the user's.
      expect(pngHeader(companionPetPath(pose)), pose).toEqual({
        width: COMPANION_ART_SIZE,
        height: COMPANION_ART_SIZE,
        colorType: 6,
      });
    }
  });

  test("every strip holds exactly the drawings its motion counts", () => {
    // The strip and the manifest come out of one export so they cannot
    // disagree; this is what notices if someone edits either by hand.
    for (const pose of POSES) {
      const motion = companionMotion(pose);
      expect(pngHeader(companionStripPath(pose)), pose).toEqual({
        width: COMPANION_ART_SIZE * motion.frames,
        height: COMPANION_ART_SIZE,
        colorType: 6,
      });
    }
  });

  test("every loop starts at rest and only names drawings that exist", () => {
    for (const pose of POSES) {
      const motion = companionMotion(pose);
      expect(motion.frames, pose).toBeGreaterThan(1);
      expect(motion.loop.length, pose).toBeGreaterThan(1);
      expect(motion.loop[0]?.[0], pose).toBe(0);
      const used = new Set<number>();
      for (const [frame, gapMs] of motion.loop) {
        expect(frame, pose).toBeLessThan(motion.frames);
        expect(gapMs, pose).toBeGreaterThan(0);
        used.add(frame);
      }
      // A drawing no beat shows is art in the binary nothing can play.
      expect(used.size, pose).toBe(motion.frames);
    }
  });

  test("she is never fast: nothing loops quicker than a trot", () => {
    for (const pose of POSES) {
      const period = companionMotion(pose).loop.reduce((total, [, gapMs]) => total + gapMs, 0);
      expect(period, pose).toBeGreaterThanOrEqual(300);
    }
  });
});
