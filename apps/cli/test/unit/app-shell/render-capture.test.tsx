import { describe, expect, test } from "bun:test";

import { useDebouncedViewportPolicy, useShellDimensions } from "@/app-shell/use-viewport-policy";
import { Text, useInput } from "ink";
import React, { useEffect, useState } from "react";

import {
  CAPTURE_WIDTHS,
  captureAllWidths,
  captureFrame,
  captureResizeSequence,
  render,
  simulateTicks,
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

  test("flicker probe: a calm surface stays on a single frame across simulated ticks", () => {
    const report = simulateTicks(<Calm />, { rounds: 5 });
    expect(report.commits).toBe(1);
    expect(report.distinctFrames).toBe(1);
  });

  test("flicker probe: a timer-driven surface emits multiple distinct frames", () => {
    // Use the deterministic ticker shim so the assertion is exactly
    // "one commit per timer fire" rather than the real-time "more than one
    // commit in 120ms" race the old assertion relied on.
    const report = simulateTicks(<Flickering />, { rounds: 5 });
    // 1 mount + 5 setInterval fires = 6 commits; at least 4 distinct
    // because the first few ticks share their first digit ("tick 0"/"tick 1"
    // both render `tick <digit>` in 7 chars).
    expect(report.commits).toBe(6);
    expect(report.distinctFrames).toBeGreaterThanOrEqual(4);
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

describe("render() handle", () => {
  function Counter({ count }: { count: number }) {
    return <Text>n={count}</Text>;
  }

  test("preserves the configured width on rerender", () => {
    const handle = render(<Counter count={0} />, { columns: 80 });
    expect(handle.lastFrame()).toContain("n=0");
    handle.rerender(<Counter count={1} />);
    expect(handle.lastFrame()).toContain("n=1");
    // The harness retains the width on rerender so width assertions don't drift.
    expect(handle.width).toBe(80);
    handle.unmount();
  });

  test("rerender commits exactly one new frame per call", () => {
    const handle = render(<Counter count={0} />, { columns: 100 });
    const before = handle.frames.length;
    handle.rerender(<Counter count={1} />);
    handle.rerender(<Counter count={2} />);
    // Two rerenders → exactly two new frames, no spurious extra commits.
    expect(handle.frames.length - before).toBe(2);
    handle.unmount();
  });

  test("stdin.enqueue drives useInput handlers", () => {
    const seen: string[] = [];
    function Probe() {
      useInput((input) => {
        seen.push(input);
      });
      return <Text>ready</Text>;
    }
    const handle = render(<Probe />, { columns: 80 });
    handle.stdin.enqueue("a");
    handle.stdin.enqueue("b");
    handle.stdin.enqueue("c");
    expect(seen).toEqual(["a", "b", "c"]);
    handle.unmount();
  });

  test("frames include commits caused by stdin-driven state updates", () => {
    function Probe() {
      const [value, setValue] = useState("ready");
      useInput((input) => {
        setValue(input);
      });
      return <Text>value={value}</Text>;
    }
    const handle = render(<Probe />, { columns: 80 });
    const before = handle.frames.length;
    handle.stdin.enqueue("a");
    handle.stdin.enqueue("b");
    expect(handle.lastFrame()).toContain("value=b");
    expect(handle.frames.length - before).toBe(2);
    handle.unmount();
  });

  test("stdin.enqueue accepts multi-character escape sequences", () => {
    const seen: Array<{ input: string; key: string }> = [];
    function Probe() {
      useInput((input, key) => {
        seen.push({
          input,
          key: key.upArrow ? "up" : key.return ? "enter" : "",
        });
      });
      return <Text>ready</Text>;
    }
    const handle = render(<Probe />, { columns: 80 });
    handle.stdin.enqueue("\x1b[A"); // up arrow
    handle.stdin.enqueue("\r"); // return
    expect(seen).toEqual([
      { input: "", key: "up" },
      { input: "\r", key: "enter" },
    ]);
    handle.unmount();
  });

  test("unmount is idempotent", () => {
    const handle = render(<Counter count={0} />);
    handle.unmount();
    expect(() => handle.unmount()).not.toThrow();
  });
});

describe("simulateTicks (deterministic flicker probe)", () => {
  test("idle surface commits exactly one frame for any number of rounds", () => {
    const report = simulateTicks(<Calm />, { rounds: 10 });
    expect(report.distinctFrames).toBe(1);
    expect(report.commits).toBe(1);
  });

  test("each tick that mutates state produces exactly one new distinct frame", () => {
    let trigger: (() => void) | null = null;
    function Ticker() {
      const [n, setN] = useState(0);
      trigger = () => setN((v) => v + 1);
      return <Text>n={n}</Text>;
    }
    const report = simulateTicks(<Ticker />, {
      rounds: 5,
      tick: () => {
        trigger?.();
      },
    });
    // 1 initial mount frame + 5 distinct tick frames = 6 distinct.
    expect(report.distinctFrames).toBe(6);
  });
});
