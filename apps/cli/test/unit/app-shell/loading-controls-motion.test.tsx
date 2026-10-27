import { expect, test } from "bun:test";

import { LoadingShell } from "@/app-shell/loading-shell";
import { RootContentSuspension } from "@/app-shell/RootContentSuspension";

import { simulateTicks } from "../../harness/render-capture";

test.each(["waiting", "playing", "failure", "covered", "reduced"] as const)(
  "%s animates only an actual visible wait and honors motion preferences",
  (mode) => {
    const saved = {
      reduced: process.env.KUNAI_REDUCED_MOTION,
      noMotion: process.env.NO_MOTION,
      pet: process.env.KUNAI_PET,
    };
    delete process.env.NO_MOTION;
    process.env.KUNAI_REDUCED_MOTION = mode === "reduced" ? "1" : "0";
    process.env.KUNAI_PET = "off";
    try {
      const report = simulateTicks(
        <RootContentSuspension suspended={mode === "covered"}>
          <LoadingShell
            state={{
              title: "Motion fixture",
              operation: mode === "playing" ? "playing" : "resolving",
              latestIssue: mode === "failure" ? "no source" : undefined,
            }}
          />
        </RootContentSuspension>,
        { rounds: 6, columns: 100, rows: 40 },
      );
      if (mode === "waiting") expect(report.distinctFrames).toBeGreaterThan(1);
      else expect(report.distinctFrames).toBe(1);
    } finally {
      for (const [key, value] of [
        ["KUNAI_REDUCED_MOTION", saved.reduced],
        ["NO_MOTION", saved.noMotion],
        ["KUNAI_PET", saved.pet],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);
