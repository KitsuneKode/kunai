// =============================================================================
// settle-value.test.tsx — anti-churn settle/suppression contracts.
//
// These lock the two behaviours the calendar latency fix depends on, expressed
// through REAL input delivery + committed frames rather than internal state:
//
//   1. useSettledValue lags rapid changes and only catches up once they rest,
//      so heavy per-selection work (poster fetch, chafa/Kitty spawn) is deferred.
//   2. A navigation burst commits ~one frame per keystroke (highlight moves
//      instantly); the settled preview does NOT add a frame per key, it updates
//      once after the burst settles. This is the "no background thread blocking
//      the highlight" guarantee.
// =============================================================================

import { describe, expect, test } from "bun:test";

import { useSettledValue } from "@/app-shell/hooks/use-settled-value";
import { Box, Text, useInput } from "ink";
import React, { act, useState } from "react";

import { render } from "../../harness/render-capture";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Counter surface: each key bumps the live value; the settled value debounces. */
function SettleProbe({ delayMs }: { readonly delayMs: number }) {
  const [n, setN] = useState(0);
  const settled = useSettledValue(n, delayMs);
  useInput(() => setN((x) => x + 1));
  return (
    <Box flexDirection="column">
      <Text>{`live=${n}`}</Text>
      <Text>{`settled=${settled}`}</Text>
    </Box>
  );
}

describe("useSettledValue", () => {
  test("lags rapid changes, then catches up to the latest once they rest", async () => {
    const handle = render(<SettleProbe delayMs={50} />, { columns: 60 });
    try {
      handle.stdin.enqueue("a");
      handle.stdin.enqueue("a");
      handle.stdin.enqueue("a");
      // Live value tracks every press; settled stays at the seed mid-burst.
      expect(handle.lastFrame()).toContain("live=3");
      expect(handle.lastFrame()).toContain("settled=0");

      // Once the burst rests past the delay, settled jumps straight to the
      // latest value (3) — not 1, 2, 3 — because intermediate timers were
      // cleared by each new change.
      await act(async () => {
        await sleep(90);
      });
      expect(handle.lastFrame()).toContain("live=3");
      expect(handle.lastFrame()).toContain("settled=3");
    } finally {
      handle.unmount();
    }
  });
});

/** List surface: ↓ moves the highlight instantly; the preview reads the settled index. */
function NavProbe({ delayMs }: { readonly delayMs: number }) {
  const [index, setIndex] = useState(0);
  const settled = useSettledValue(index, delayMs);
  useInput((_input, key) => {
    if (key.downArrow) setIndex((i) => i + 1);
  });
  return (
    <Box flexDirection="column">
      <Text>{`idx=${index}`}</Text>
      <Text>{`preview=${settled}`}</Text>
    </Box>
  );
}

describe("navigation burst frame-count", () => {
  test("commits exactly one frame per keystroke during a hold; preview defers", async () => {
    const handle = render(<NavProbe delayMs={50} />, { columns: 60 });
    try {
      const before = handle.frames.length;
      const presses = 5;
      for (let i = 0; i < presses; i++) {
        handle.stdin.enqueue("\u001b[B"); // down arrow
      }
      // Each press = one highlight commit. No extra frames from the settled
      // preview (its timer is still pending), and no dropped/stalled frames.
      expect(handle.frames.length - before).toBe(presses);
      expect(handle.lastFrame()).toContain("idx=5");
      expect(handle.lastFrame()).toContain("preview=0");

      // After the burst settles, the preview catches up in a single extra frame.
      await act(async () => {
        await sleep(90);
      });
      expect(handle.frames.length - before).toBe(presses + 1);
      expect(handle.lastFrame()).toContain("preview=5");
    } finally {
      handle.unmount();
    }
  });
});
