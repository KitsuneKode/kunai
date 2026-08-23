import { describe, expect, test } from "bun:test";

import { ClaudeTabRow } from "@/app-shell/primitives/ClaudeTabRow";
import React from "react";

import { render } from "../../harness/render-capture";
import { renderedWidth } from "../../support/rendered-width";

/** The real Settings sections, in order. */
const SETTINGS_SECTIONS = [
  "General",
  "Discover",
  "Provider",
  "Providers",
  "YouTube",
  "Language",
  "Playback",
  "Offline",
  "Presence",
  "Sync",
  "Update",
  "Danger Zone",
];

function stripAt(columns: number, activeIndex: number): string[] {
  const handle = render(
    <ClaudeTabRow
      labels={SETTINGS_SECTIONS}
      activeIndex={activeIndex}
      hint="Tab / Shift+Tab"
      maxWidth={columns}
    />,
    { columns },
  );
  const frame = handle.lastFrame();
  handle.unmount();
  return frame.split("\n").filter((line) => line.trim().length > 0);
}

describe("Settings tab strip at narrow widths", () => {
  test("stays on one line at 80 columns instead of wrapping into stumps", () => {
    // Twelve section names do not fit in 80 columns. Squeezing them produced a
    // second line of two-character fragments ("GenDiscProvProvid…" over
    // "era ove ide er") that hid which sections exist at all.
    const lines = stripAt(80, 0);

    expect(lines).toHaveLength(1);
    // Display columns, not `.length`: Ink emits colour inline, so counting
    // characters made this assertion depend on FORCE_COLOR rather than layout.
    expect(renderedWidth(lines[0] ?? "")).toBeLessThanOrEqual(80);
  });

  test("shows the active section name in full at every position", () => {
    for (const [index, section] of SETTINGS_SECTIONS.entries()) {
      const lines = stripAt(80, index);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(section);
    }
  });

  test("marks that there is more to scroll to", () => {
    expect(stripAt(80, 0).join("")).toContain("›");
    expect(stripAt(80, SETTINGS_SECTIONS.length - 1).join("")).toContain("‹");
  });

  test("survives a very narrow terminal without wrapping", () => {
    for (const columns of [40, 50, 60, 70]) {
      const lines = stripAt(columns, 5);
      expect(lines).toHaveLength(1);
      expect(renderedWidth(lines[0] ?? "")).toBeLessThanOrEqual(columns);
    }
  });
});
