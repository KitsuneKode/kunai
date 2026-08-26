import { expect, test } from "bun:test";

import { TrackerConnectShell, type TrackerConnectOutcome } from "@/app-shell/tracker-connect-shell";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

async function flushMicrotasks(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

test("the visible tracker handoff owns cancellation", async () => {
  let connectSignal: AbortSignal | undefined;
  const results: TrackerConnectOutcome[] = [];
  const handle = render(
    <TrackerConnectShell
      trackerName="AniList"
      connect={(signal, onPrompt) => {
        connectSignal = signal;
        onPrompt("Approve Kunai in the browser.");
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ status: "cancelled" }), {
            once: true,
          });
        });
      }}
      finish={(result) => results.push(result)}
    />,
    { columns: 100, rows: 32 },
  );

  try {
    expect(handle.lastFrame()).toContain("Approve Kunai in the browser.");
    expect(handle.lastFrame()).toContain("[esc]");
    expect(handle.lastFrame()).toContain("cancel");

    handle.stdin.enqueue("q");
    await act(async () => flushMicrotasks());

    expect(connectSignal?.aborted).toBe(true);
    expect(results).toEqual([{ status: "cancelled" }]);
  } finally {
    handle.unmount();
  }
});

test("a failed tracker handoff stays visible and retries in place", async () => {
  let attempts = 0;
  const results: TrackerConnectOutcome[] = [];
  const handle = render(
    <TrackerConnectShell
      trackerName="TMDB"
      connect={async () => {
        attempts += 1;
        return attempts === 1
          ? { status: "failed", error: "The browser approval expired." }
          : { status: "connected" };
      }}
      finish={(result) => results.push(result)}
    />,
    { columns: 100, rows: 32 },
  );

  try {
    await act(async () => flushMicrotasks());
    expect(handle.lastFrame()).toContain("The browser approval expired.");
    expect(handle.lastFrame()).toContain("[r]");
    expect(handle.lastFrame()).toContain("retry");
    expect(results).toHaveLength(0);

    handle.stdin.enqueue("r");
    await act(async () => flushMicrotasks());

    expect(attempts).toBe(2);
    expect(results).toEqual([{ status: "connected" }]);
  } finally {
    handle.unmount();
  }
});
