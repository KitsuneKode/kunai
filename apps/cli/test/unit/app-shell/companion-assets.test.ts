import { describe, expect, test } from "bun:test";

import {
  companionMotion,
  companionPetPath,
  companionStripPath,
} from "@/app-shell/companion-assets";
import type { CompanionPose } from "@/app-shell/companion-policy";

import motion from "../../../src/app-shell/brand/pets/motion.json";

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

/** Width and height from a PNG's IHDR, which always sits at byte 16. */
async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const bytes = await Bun.file(path).bytes();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("companion assets", () => {
  test("every pose ships a still and a strip next to the shell", async () => {
    for (const pose of POSES) {
      expect(Bun.file(companionPetPath(pose)).size, pose).toBeGreaterThan(500);
      expect(Bun.file(companionStripPath(pose)).size, pose).toBeGreaterThan(500);
    }
  });

  test("a strip holds exactly the drawings its motion says, at the still's size", async () => {
    // The sprite slices the strip into `frames` equal drawings. A strip that
    // disagreed with its manifest would cut a drawing in half on screen.
    for (const pose of POSES) {
      const still = await pngSize(companionPetPath(pose));
      const strip = await pngSize(companionStripPath(pose));
      expect(still, pose).toEqual({ width: motion.size, height: motion.size });
      expect(strip, pose).toEqual({
        width: motion.size * companionMotion(pose).frames,
        height: motion.size,
      });
    }
  });

  test("every beat of a loop names a drawing that exists and holds for a real gap", () => {
    for (const pose of POSES) {
      const { frames, loop } = companionMotion(pose);
      expect(loop.length, pose).toBeGreaterThan(1);
      for (const [frame, gapMs] of loop) {
        expect(frame, pose).toBeGreaterThanOrEqual(0);
        expect(frame, pose).toBeLessThan(frames);
        expect(gapMs, pose).toBeGreaterThan(0);
      }
    }
  });
});
