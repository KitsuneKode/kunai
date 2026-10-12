// =============================================================================
// dwell-prefetch.test.tsx — the ~500ms "rested row" prefetch contract.
//
// Same harness as settle-value.test.tsx: REAL input delivery + committed
// frames, `dwellMs` injected per test so no wall-clock assumptions. The hook
// owns three guarantees:
//
//   1. A rested row fires once with an AbortSignal.
//   2. A navigation burst never fires — each new value cancels the prior timer.
//   3. Latest-wins: moving on aborts the in-flight warm's signal.
// =============================================================================

import { describe, expect, test } from "bun:test";

import { useDwellPrefetch } from "@/app-shell/hooks/use-dwell-prefetch";
import { Text, useInput } from "ink";
import React, { act, useState } from "react";

import { render } from "../../harness/render-capture";
import { waitUntil } from "../../support/wait-until";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PrefetchCall = {
  readonly value: number;
  readonly signal: AbortSignal;
};

function PrefetchProbe({
  dwellMs,
  calls,
}: {
  readonly dwellMs: number;
  readonly calls: PrefetchCall[];
}) {
  const [index, setIndex] = useState(0);
  useDwellPrefetch(
    index,
    (value, signal) => {
      calls.push({ value, signal });
    },
    dwellMs,
  );
  useInput((_input, key) => {
    if (key.downArrow) setIndex((i) => i + 1);
  });
  return <Text>{`idx=${index}`}</Text>;
}

describe("useDwellPrefetch", () => {
  test("fires once after the row rests past the dwell window", async () => {
    const calls: PrefetchCall[] = [];
    const handle = render(<PrefetchProbe dwellMs={40} calls={calls} />, { columns: 40 });
    try {
      await waitUntil(() => calls.length === 1, {
        label: "dwell prefetch fired",
        tick: async (ms) => {
          await act(async () => {
            await sleep(ms);
          });
        },
      });
      expect(calls[0]?.value).toBe(0);
      expect(calls[0]?.signal.aborted).toBe(false);
    } finally {
      handle.unmount();
    }
  });

  test("a held navigation burst never fires mid-burst, then fires on the landing row", async () => {
    const calls: PrefetchCall[] = [];
    const handle = render(<PrefetchProbe dwellMs={60} calls={calls} />, { columns: 40 });
    try {
      // Burst faster than the dwell window — each press cancels the armed timer.
      for (let i = 0; i < 4; i++) {
        handle.stdin.enqueue("[B");
      }
      expect(calls).toHaveLength(0);

      await waitUntil(() => calls.length === 1, {
        label: "dwell prefetch fired on landing row",
        tick: async (ms) => {
          await act(async () => {
            await sleep(ms);
          });
        },
      });
      expect(calls[0]?.value).toBe(4);
    } finally {
      handle.unmount();
    }
  });

  test("moving to the next row aborts the in-flight prefetch (latest-wins)", async () => {
    const calls: PrefetchCall[] = [];
    const handle = render(<PrefetchProbe dwellMs={30} calls={calls} />, { columns: 40 });
    try {
      await waitUntil(() => calls.length === 1, {
        label: "first dwell prefetch fired",
        tick: async (ms) => {
          await act(async () => {
            await sleep(ms);
          });
        },
      });
      // In-flight warm for row 0 must be cancelled the moment the cursor moves.
      handle.stdin.enqueue("[B");
      expect(calls[0]?.signal.aborted).toBe(true);

      await waitUntil(() => calls.length === 2, {
        label: "second dwell prefetch fired",
        tick: async (ms) => {
          await act(async () => {
            await sleep(ms);
          });
        },
      });
      expect(calls[1]?.value).toBe(1);
      expect(calls[1]?.signal.aborted).toBe(false);
    } finally {
      handle.unmount();
    }
  });

  test("a throwing callback is swallowed — prefetch can never kill the shell", async () => {
    let threw = false;
    function ThrowingProbe() {
      const [index] = useState(0);
      useDwellPrefetch(
        index,
        () => {
          threw = true;
          throw new Error("boom");
        },
        20,
      );
      return <Text>{`idx=${index}`}</Text>;
    }
    const handle = render(<ThrowingProbe />, { columns: 40 });
    try {
      await waitUntil(() => threw, {
        label: "throwing callback ran",
        tick: async (ms) => {
          await act(async () => {
            await sleep(ms);
          });
        },
      });
      // The component is still alive and rendering after the throw.
      expect(handle.lastFrame()).toContain("idx=0");
    } finally {
      handle.unmount();
    }
  });
});
