import { describe, expect, test } from "bun:test";

import { useDebouncedViewportPolicy, useShellDimensions } from "@/app-shell/use-viewport-policy";
import { Text } from "ink";
import React, { useEffect, useState } from "react";

import {
  CAPTURE_WIDTHS,
  captureAllWidths,
  captureFrame,
  captureResizeSequence,
  countCommits,
} from "../../harness/render-capture";

// Reads the width Ink sees and prints it — proves the harness propagates the
// configured columns all the way into the component (useStdout / useViewportPolicy).
function WidthProbe() {
  const { cols } = useShellDimensions();
  return <Text>cols={cols}</Text>;
}

// A calm surface: one render, one frame, forever.
function Calm() {
  return <Text>steady</Text>;
}

// A flickering surface: re-renders on a timer with no user input — exactly the
// class of bug the probe must catch (loader desync / poster ghost / palette).
function DebouncedWidthProbe() {
  const viewport = useDebouncedViewportPolicy("browse");
  const innerWidth = Math.max(24, viewport.columns - 8);
  return (
    <Text>
      cols={viewport.columns} sep={"─".repeat(Math.min(innerWidth, 24))}
    </Text>
  );
}

function Flickering() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 20);
    return () => clearInterval(id);
  }, []);
  return <Text>tick {tick}</Text>;
}

describe("render-capture harness", () => {
  test("propagates the configured width into the rendered surface", () => {
    expect(captureFrame(<WidthProbe />, { columns: CAPTURE_WIDTHS.narrow })).toContain("cols=72");
    expect(captureFrame(<WidthProbe />, { columns: CAPTURE_WIDTHS.medium })).toContain("cols=100");
    expect(captureFrame(<WidthProbe />, { columns: CAPTURE_WIDTHS.wide })).toContain("cols=140");
  });

  test("captureAllWidths returns a frame per breakpoint", () => {
    const frames = captureAllWidths(<WidthProbe />);
    expect(frames.narrow).toContain("cols=72");
    expect(frames.medium).toContain("cols=100");
    expect(frames.wide).toContain("cols=140");
  });

  test("flicker probe: a calm surface settles to a single frame", async () => {
    const report = await countCommits(<Calm />, { durationMs: 120 });
    expect(report.distinctFrames).toBe(1);
  });

  test("flicker probe: a timer-driven surface emits multiple distinct frames", async () => {
    const report = await countCommits(<Flickering />, { durationMs: 120 });
    expect(report.distinctFrames).toBeGreaterThan(1);
  });

  test("captureResizeSequence updates width after simulated shrink", () => {
    const frames = captureResizeSequence(<WidthProbe />, [
      { columns: CAPTURE_WIDTHS.wide, rows: 45 },
      { columns: CAPTURE_WIDTHS.narrow, rows: 24 },
    ]);
    expect(frames[0]).toContain("cols=140");
    expect(frames[1]).toContain("cols=72");
  });

  test("debounced viewport settles immediately on shrink", () => {
    const frames = captureResizeSequence(<DebouncedWidthProbe />, [
      { columns: CAPTURE_WIDTHS.wide, rows: 45 },
      { columns: CAPTURE_WIDTHS.narrow, rows: 24 },
    ]);
    expect(frames[0]).toContain("cols=140");
    expect(frames[1]).toContain("cols=72");
    expect(frames[1]).not.toContain("cols=140");
  });
});
