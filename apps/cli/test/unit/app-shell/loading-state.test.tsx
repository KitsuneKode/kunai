import { describe, expect, test } from "bun:test";

import { LoadingState } from "@/app-shell/primitives/LoadingState";
import React from "react";

import { simulateTicks } from "../../harness/render-capture";

function withEnv(name: string, value: string | undefined, run: () => void): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe("LoadingState spinner", () => {
  test("cycles its glyph while motion is allowed", () => {
    withEnv("KUNAI_REDUCED_MOTION", undefined, () => {
      withEnv("NO_MOTION", undefined, () => {
        const report = simulateTicks(<LoadingState message="resolving" />, { rounds: 5 });
        expect(report.commits).toBe(6);
        expect(report.distinctFrames).toBeGreaterThanOrEqual(3);
      });
    });
  });

  test("holds a single frame under KUNAI_REDUCED_MOTION", () => {
    withEnv("KUNAI_REDUCED_MOTION", "1", () => {
      const report = simulateTicks(<LoadingState message="resolving" />, { rounds: 5 });
      expect(report.commits).toBe(1);
      expect(report.distinctFrames).toBe(1);
    });
  });

  test("KUNAI_REDUCED_MOTION=0 does not freeze it", () => {
    withEnv("NO_MOTION", undefined, () => {
      withEnv("KUNAI_REDUCED_MOTION", "0", () => {
        const report = simulateTicks(<LoadingState message="resolving" />, { rounds: 5 });
        expect(report.distinctFrames).toBeGreaterThanOrEqual(3);
      });
    });
  });
});
