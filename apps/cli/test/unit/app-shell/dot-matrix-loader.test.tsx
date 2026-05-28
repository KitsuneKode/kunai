import { describe, expect, test } from "bun:test";

import { DotMatrixLoader } from "@/app-shell/dot-matrix-loader";
import React from "react";

import { countCommits } from "../../harness/render-capture";

describe("DotMatrixLoader animation", () => {
  test("flicker probe: one commit per animation tick without duplicate frames", async () => {
    const intervalMs = 80;
    const durationMs = 250;
    const report = await countCommits(
      <DotMatrixLoader variant="flux-columns" intervalMs={intervalMs} active />,
      { durationMs },
    );

    const expectedTicks = Math.floor(durationMs / intervalMs);
    expect(report.distinctFrames).toBeGreaterThanOrEqual(Math.max(1, expectedTicks - 1));
    expect(report.distinctFrames).toBeLessThanOrEqual(expectedTicks + 2);
    expect(report.commits).toBeLessThanOrEqual(report.distinctFrames + 2);
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
