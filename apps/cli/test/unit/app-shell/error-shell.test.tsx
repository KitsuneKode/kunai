import { describe, expect, test } from "bun:test";

import { ErrorShell } from "@/app-shell/root-status-shells";
import React, { act } from "react";

import { CAPTURE_WIDTHS, captureFrame, render } from "../../harness/render-capture";

/**
 * Let the petal-fall interval run for real, with its state updates flushed
 * inside an act() boundary. The panel is interval-driven, so a bare sleep
 * leaves React warning about unwrapped updates — and this harness treats that
 * warning as a defect rather than noise.
 */
const advance = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

const props = {
  message: "An unknown error occurred",
  scenario: { kind: "provider-timeout", providerName: "allmanga", elapsedSec: 12 } as const,
  waterfall: {
    title: "Source attempts",
    truncated: false,
    rows: [
      { label: "search", detail: "0.4s", status: "succeeded" as const },
      { label: "resolve", detail: "timed out", status: "failed" as const },
    ],
  },
  onResolve: () => {},
  onRetry: () => {},
};

/** Longest line in the frame — the panel's outer width as actually rendered. */
const frameWidth = (frame: string) =>
  Math.max(...frame.split("\n").map((line) => [...line.trimEnd()].length));

describe("ErrorShell", () => {
  test("renders the headline, scenario detail and waterfall", () => {
    const frame = captureFrame(<ErrorShell {...props} />, { columns: CAPTURE_WIDTHS.medium });
    expect(frame).toContain("Playback failed");
    expect(frame).toContain("timed out after 12s");
    expect(frame).toContain("allmanga");
    expect(frame).toContain("Source attempts");
    expect(frame).toContain("resolve");
    expect(frame).toContain("r retry");
  });

  test("falls back to the raw message with no scenario", () => {
    const frame = captureFrame(<ErrorShell message="boom" onResolve={() => {}} />, {
      columns: CAPTURE_WIDTHS.medium,
    });
    expect(frame).toContain("boom");
  });

  // The layout constraint, asserted on real rendered frames.
  //
  // This test must WATCH the fall, not just mount the panel: a static panel
  // commits exactly one frame, and "all one frame has the same width" is
  // vacuously true. Waiting past several 380ms steps means the width assertion
  // is made across genuinely different frames, and the distinct-frame check
  // fails loudly if the animation ever stops running at all.
  test("panel width never changes across the frames of the fall", async () => {
    const handle = render(<ErrorShell {...props} />, { columns: CAPTURE_WIDTHS.medium });
    try {
      await advance(1300);
      const panelFrames = handle.frames.filter((frame) => frame.includes("Playback failed"));

      // Guard against the assertion below passing for the wrong reason.
      expect(new Set(panelFrames).size).toBeGreaterThan(1);

      expect(new Set(panelFrames.map(frameWidth)).size).toBe(1);
    } finally {
      handle.unmount();
    }
  });

  test("renders at every canonical width without exceeding the terminal", () => {
    for (const columns of Object.values(CAPTURE_WIDTHS)) {
      const frame = captureFrame(<ErrorShell {...props} />, { columns });
      expect(frame).toContain("Playback failed");
      for (const line of frame.split("\n")) {
        expect([...line.trimEnd()].length).toBeLessThanOrEqual(columns);
      }
    }
  });

  test("r triggers retry", () => {
    let retried = 0;
    const handle = render(
      <ErrorShell
        {...props}
        onRetry={() => {
          retried += 1;
        }}
      />,
      { columns: CAPTURE_WIDTHS.medium },
    );
    try {
      handle.stdin.enqueue("r");
      expect(retried).toBe(1);
    } finally {
      handle.unmount();
    }
  });

  test("Enter resolves", () => {
    let resolved = 0;
    const handle = render(
      <ErrorShell
        {...props}
        onResolve={() => {
          resolved += 1;
        }}
      />,
      { columns: CAPTURE_WIDTHS.medium },
    );
    try {
      handle.stdin.enqueue("\r");
      expect(resolved).toBe(1);
    } finally {
      handle.unmount();
    }
  });

  test("under reduced motion it renders the settled panel with no clock", async () => {
    const previous = process.env.KUNAI_REDUCED_MOTION;
    process.env.KUNAI_REDUCED_MOTION = "1";
    try {
      const handle = render(<ErrorShell {...props} />, { columns: CAPTURE_WIDTHS.medium });
      try {
        await advance(500);
        // A still panel commits its mount frame and nothing further.
        expect(new Set(handle.frames).size).toBe(1);
        expect(handle.lastFrame()).toContain("Playback failed");
      } finally {
        handle.unmount();
      }
    } finally {
      if (previous === undefined) delete process.env.KUNAI_REDUCED_MOTION;
      else process.env.KUNAI_REDUCED_MOTION = previous;
    }
  });
});
