import { describe, expect, test } from "bun:test";

import { useFrameTick } from "@/app-shell/primitives/SakuraPetal";
import { Text } from "ink";
import React from "react";

import { simulateTicks } from "../../harness/render-capture";

function Probe({ stopAfter }: { readonly stopAfter?: number }) {
  const tick = useFrameTick(true, 380, stopAfter);
  return <Text>{`tick=${tick}`}</Text>;
}

describe("useFrameTick", () => {
  test("without stopAfter it keeps ticking for the whole window", () => {
    // 1 mount frame + 6 ticks, each a distinct tick value.
    const report = simulateTicks(<Probe />, { rounds: 6 });
    expect(report.distinctFrames).toBe(7);
  });

  test("stops committing new frames once stopAfter is reached", () => {
    // Ticks 0,1,2,3 are distinct; the interval clears at 3 and rounds 4-9 add nothing.
    const report = simulateTicks(<Probe stopAfter={3} />, { rounds: 9 });
    expect(report.distinctFrames).toBe(4);
  });

  test("stopAfter of 0 never starts a clock", () => {
    const report = simulateTicks(<Probe stopAfter={0} />, { rounds: 5 });
    expect(report.distinctFrames).toBe(1);
  });
});
