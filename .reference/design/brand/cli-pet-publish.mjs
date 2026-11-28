// Staged publication for the CLI companion art. The exporter renders into a
// private directory, validates the whole set, and only then replaces the files
// the CLI embeds — a failed drawing never leaves a new strip beside an old
// motion manifest.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";

function pngInfo(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 26 || bytes[25] !== 6) {
    throw new Error(`${path.basename(file)} is not a PNG32 image with per-pixel alpha`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Validate the generated manifest against itself and the staged strip sizes. */
export function validateStagedCliAssets(stageDir, manifest, size) {
  for (const [pose, motion] of Object.entries(manifest)) {
    if (!Number.isInteger(motion.frames) || motion.frames < 2) {
      throw new Error(`${pose}: invalid frame count ${motion.frames}`);
    }
    if (!Array.isArray(motion.loop) || motion.loop.length < 2 || motion.loop[0]?.[0] !== 0) {
      throw new Error(`${pose}: the loop must start at rest`);
    }
    const used = new Set();
    for (const [frame, gapMs] of motion.loop) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= motion.frames) {
        throw new Error(`${pose}: loop frame ${frame} is outside 0..${motion.frames - 1}`);
      }
      if (!Number.isInteger(gapMs) || gapMs <= 0) {
        throw new Error(`${pose}: loop gap ${gapMs} is not positive`);
      }
      used.add(frame);
    }
    if (used.size !== motion.frames) {
      throw new Error(`${pose}: ${motion.frames} drawings exist but only ${used.size} are played`);
    }

    for (const file of [`${pose}.png`, `${pose}.strip.png`]) {
      const staged = path.join(stageDir, file);
      if (!existsSync(staged) || statSync(staged).size === 0) {
        throw new Error(`${file} was not rendered`);
      }
      const info = pngInfo(staged);
      const expectedWidth = file.endsWith(".strip.png") ? size * motion.frames : size;
      if (info.width !== expectedWidth || info.height !== size) {
        throw new Error(
          `${file} is ${info.width}x${info.height}, expected ${expectedWidth}x${size}`,
        );
      }
    }
  }
}

/**
 * Publish an already-validated staged set. The manifest moves last, after every
 * asset it describes, and each file is copied beside its destination before the
 * rename so readers never see a truncated PNG or JSON document.
 */
export function publishStagedCliAssets(stageDir, destDir, manifest, size) {
  validateStagedCliAssets(stageDir, manifest, size);
  mkdirSync(destDir, { recursive: true });
  const files = Object.keys(manifest).flatMap((pose) => [`${pose}.png`, `${pose}.strip.png`]);
  files.push("motion.json");
  for (const file of files) {
    const from = path.join(stageDir, file);
    const to = path.join(destDir, file);
    const temporary = `${to}.next`;
    copyFileSync(from, temporary);
    renameSync(temporary, to);
  }
}
