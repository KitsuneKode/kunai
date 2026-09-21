import { describe, expect, test } from "bun:test";

import { ErrorShell } from "@/app-shell/root-status-shells";
import React, { act } from "react";

import { CAPTURE_WIDTHS, captureFrame, render } from "../../harness/render-capture";
import { frameWidth, renderedWidth } from "../../support/rendered-width";
import { waitUntil } from "../../support/wait-until";

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
      await waitUntil(
        () => new Set(handle.frames.filter((frame) => frame.includes("Playback failed"))).size > 1,
        {
          label: "petal fall advanced past the mount frame",
          tick: async (ms) => {
            await advance(ms);
          },
        },
      );
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
        // Display columns, not character count — Ink's inline colour codes are
        // not glyphs, and a wide glyph is not one column.
        expect(renderedWidth(line)).toBeLessThanOrEqual(columns);
      }
    }
  });

  // #465: the cell buffer used to count code points as columns, so an
  // unwrapped CJK row (waterfall entries are never wrapped) rendered nearly
  // twice its allotted width and petal lanes measured where text ended in the
  // wrong place.
  test("an unwrapped CJK waterfall row stays inside the panel width", () => {
    const frame = captureFrame(
      <ErrorShell
        {...props}
        waterfall={{
          title: "ソースの試行",
          truncated: false,
          rows: [
            {
              label: "ストリーム解決プロバイダーの直接接続を試行しています",
              detail: "タイムアウトしました",
              status: "failed" as const,
            },
          ],
        }}
      />,
      { columns: CAPTURE_WIDTHS.narrow },
    );
    expect(frame).toContain("Playback failed");
    for (const line of frame.split("\n")) {
      expect(renderedWidth(line)).toBeLessThanOrEqual(CAPTURE_WIDTHS.narrow);
    }
  });

  // #465: the sentence that says what failed used to clip mid-word with no
  // ellipsis. It now wraps inside the panel, and only a message longer than
  // the row budget shows the cut — with a visible marker.
  test("a long failure message wraps instead of clipping silently", () => {
    const message =
      "The upstream provider rejected the signed playback URL because the session " +
      "token expired; refresh it under /settings or pick another provider";
    const frame = captureFrame(<ErrorShell message={message} onResolve={() => {}} />, {
      columns: CAPTURE_WIDTHS.medium,
    });
    expect(frame).toContain("The upstream provider rejected");
    expect(frame).toContain("pick another provider");
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

  // Partial cover for the input-responsiveness risk. This proves the running
  // interval does not starve the useInput handler in the React/Ink layer. It
  // does NOT cover the real-terminal failure mode this repo has hit before —
  // synchronous stdout writes on a repaint loop blocking stdin — because the
  // capture harness writes to a buffer, not a TTY. That still needs a hand check.
  test("r still triggers retry while the petals are mid-fall", async () => {
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
      await advance(50);
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
