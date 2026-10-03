import { expect, test } from "bun:test";

import { LoadingShell } from "@/app-shell/loading-shell";
import type { LoadingShellState } from "@/app-shell/types";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

/**
 * Regression test for the stale-input-closure class found via live driving:
 * `o` during `● Playing` produced no Tracks panel because the useInput handler
 * resolved keys against the mount-time bootstrap snapshot
 * (operation="loading", hasStreamCandidates=false → effect=null). Keys whose
 * gate only needed a mount-stable handler (`u` autoskip) kept working, which is
 * why the dead keys went unnoticed. The handler now reads through a live ref,
 * so props/state that change after mount must be honoured.
 */

const BOOTSTRAP_STATE: LoadingShellState = {
  title: "Smoke Movie",
  operation: "loading",
  cancellable: true,
  hasStreamCandidates: false,
  providerName: "Smoke Videasy",
};

const PLAYING_STATE: LoadingShellState = {
  ...BOOTSTRAP_STATE,
  operation: "playing",
  hasStreamCandidates: true,
  currentPosition: 12,
  duration: 600,
  playbackSourceLine: "SmokeServer · videasy · smoke.kunai.test",
};

test("o opens the source picker after the stream lands mid-mount", async () => {
  let picked = 0;
  const handle = render(
    <LoadingShell state={BOOTSTRAP_STATE} onPickSource={() => (picked += 1)} />,
    { columns: 100, rows: 40 },
  );

  try {
    // The surface mounts during bootstrap when no stream exists yet; the
    // picker key must not latch that snapshot. Update the mounted tree in
    // place — `rerender` remounts and would hand a fresh closure the new
    // props even if the live-ref fix regressed.
    handle.update(<LoadingShell state={PLAYING_STATE} onPickSource={() => (picked += 1)} />);

    await act(async () => {
      handle.stdin.enqueue(["o"]);
      await Promise.resolve();
    });

    expect(picked).toBe(1);
  } finally {
    handle.unmount();
  }
});

test("esc cancels via the latest cancellable flag, not the mount one", async () => {
  let cancelled = 0;
  const onCancel = () => (cancelled += 1);
  const handle = render(<LoadingShell state={BOOTSTRAP_STATE} onCancel={onCancel} />, {
    columns: 100,
    rows: 40,
  });

  try {
    // In-place update, same reasoning as the source-picker case above.
    handle.update(
      <LoadingShell state={{ ...PLAYING_STATE, cancellable: false }} onCancel={onCancel} />,
    );

    await act(async () => {
      handle.stdin.enqueue([""]);
      await Promise.resolve();
    });

    // While playing, Esc is not a cancel — it should not fire the handler.
    expect(cancelled).toBe(0);
  } finally {
    handle.unmount();
  }
});
