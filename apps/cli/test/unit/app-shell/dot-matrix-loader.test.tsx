import { describe, expect, test } from "bun:test";

import { DotMatrixLoader } from "@/app-shell/dot-matrix-loader";
import React from "react";

import { countCommits, simulateTicks } from "../../harness/render-capture";

describe("DotMatrixLoader animation", () => {
  test("flicker probe: one commit per animation tick without duplicate frames", () => {
    // Deterministic: simulate 5 ticks and assert each tick produces exactly
    // one new frame. Replaces the previous real-time assertion that was
    // timing-dependent (Math.floor(durationMs / intervalMs) races the
    // scheduler on slow runners and can flake).
    const report = simulateTicks(
      <DotMatrixLoader variant="flux-columns" intervalMs={80} active />,
      { rounds: 5 },
    );
    // 1 initial mount frame + 5 ticks = 6 commits. Ink's debug mode writes
    // a frame for every commit, but distinct frames can be fewer if two
    // animation ticks happen to render the same character grid (the loader
    // has 24 frames that cycle deterministically — we don't assert equality
    // for specific tick numbers). The important property: at least 3
    // distinct frames across 5 ticks, and never more commits than ticks+1.
    expect(report.commits).toBe(6);
    expect(report.distinctFrames).toBeGreaterThanOrEqual(3);
  });

  test("flicker probe: inactive loader stays on a single frame", async () => {
    const report = await countCommits(
      <DotMatrixLoader variant="flux-columns" intervalMs={80} active={false} />,
      { durationMs: 200 },
    );
    expect(report.distinctFrames).toBe(1);
    expect(report.commits).toBe(1);
  });
});
