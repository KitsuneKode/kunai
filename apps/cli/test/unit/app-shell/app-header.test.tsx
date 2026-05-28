import { describe, expect, test } from "bun:test";

import { AppHeader } from "@/app-shell/primitives/AppHeader";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

// The crumb during playback is long; without width budgeting it wrapped the
// brand, truncated the pill mid-word, and let the crumb collide with the right
// status group ("header bleed"). These lock the single-line, anchored layout.
const LONG_CRUMB = "anime · allanime · Frieren: Beyond Journey's End · S01E04 · eng sub";

function nonBlankLines(frame: string): string[] {
  return frame.split("\n").filter((line) => line.trim().length > 0);
}

describe("AppHeader width budgeting", () => {
  test("stays a single line on a narrow terminal", () => {
    const frame = captureFrame(
      <AppHeader
        destination="watch"
        context={LONG_CRUMB}
        status="Playing · eng sub"
        size="64×30"
        width={62}
      />,
      { columns: 64 },
    );
    expect(nonBlankLines(frame)).toHaveLength(1);
  });

  test("never truncates the brand or the destination pill", () => {
    const frame = captureFrame(
      <AppHeader
        destination="watch"
        context={LONG_CRUMB}
        status="Playing · eng sub"
        size="64×30"
        width={62}
      />,
      { columns: 64 },
    );
    expect(frame).toContain("🦊 Kunai");
    expect(frame).toContain("watch");
  });

  test("keeps the right status group intact and truncates the crumb instead", () => {
    const frame = captureFrame(
      <AppHeader
        destination="watch"
        context={LONG_CRUMB}
        status="Playing · eng sub"
        size="64×30"
        width={62}
      />,
      { columns: 64 },
    );
    // Right group survives whole; the crumb gives way with an ellipsis.
    expect(frame).toContain("Playing · eng sub");
    expect(frame).toContain("64×30");
    expect(frame).toContain("…");
  });

  test("renders the full crumb untruncated when it fits", () => {
    const frame = captureFrame(
      <AppHeader destination="watch" context="anime · allanime" status="ready" width={120} />,
      { columns: 120 },
    );
    expect(frame).toContain("anime · allanime");
    expect(frame).not.toContain("…");
  });
});
