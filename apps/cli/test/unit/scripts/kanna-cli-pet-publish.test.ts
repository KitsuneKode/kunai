import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  publishStagedCliAssets,
  validateStagedCliAssets,
} from "../../../../../.reference/design/brand/cli-pet-publish.mjs";
import { removeTempDir } from "../../support/remove-temp-dir";

function png32(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes[25] = 6;
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function stageSet(root: string, loop: readonly (readonly [number, number])[]) {
  const stage = join(root, "stage");
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "idle.png"), png32(256, 256));
  writeFileSync(join(stage, "idle.strip.png"), png32(512, 256));
  writeFileSync(join(stage, "motion.json"), "{}\n");
  return {
    stage,
    manifest: { idle: { frames: 2, loop: loop.map(([frame, gapMs]) => [frame, gapMs]) } },
  };
}

describe("CLI companion asset publication", () => {
  test("an invalid loop is rejected before any published file is replaced", () => {
    const root = mkdtempSync(join(tmpdir(), "kanna-publish-"));
    try {
      const target = join(root, "target");
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, "idle.png"), "previous");
      const { stage, manifest } = stageSet(root, [
        [0, 300],
        [-1, 100],
      ]);
      expect(() => publishStagedCliAssets(stage, target, manifest, 256)).toThrow("outside 0..1");
      expect(readFileSync(join(target, "idle.png"), "utf8")).toBe("previous");
    } finally {
      removeTempDir(root);
    }
  });

  test("a valid staged set validates and publishes every asset with its manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "kanna-publish-"));
    try {
      const target = join(root, "target");
      const { stage, manifest } = stageSet(root, [
        [0, 300],
        [1, 120],
      ]);
      expect(() => validateStagedCliAssets(stage, manifest, 256)).not.toThrow();
      publishStagedCliAssets(stage, target, manifest, 256);
      for (const file of ["idle.png", "idle.strip.png", "motion.json"]) {
        expect(readFileSync(join(target, file)).byteLength).toBeGreaterThan(0);
      }
    } finally {
      removeTempDir(root);
    }
  });
});
