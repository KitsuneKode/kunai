import { describe, expect, test } from "bun:test";

import { AnalyticsSlide } from "@/app-shell/setup-shell";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

/**
 * 80x24 deliberately: the smallest terminal we expect, and the size at which
 * the footer hint is first at risk of being clipped.
 */
function frame(selectedIndex = 0): string {
  return captureFrame(<AnalyticsSlide width={80} rows={24} selectedIndex={selectedIndex} />, {
    columns: 80,
    rows: 24,
  });
}

describe("analytics consent slide", () => {
  test("states that skipping keeps it on", () => {
    // With an opt-out default, a bare "skip" would be a dark pattern: the user
    // would be accepting collection without being told that is what skip does.
    expect(frame()).toContain("skip (keeps it on)");
  });

  test("shows the exact payload inline, not behind another command", () => {
    const rendered = frame();
    for (const key of ["installId", "version", "os", "arch", "ts"]) {
      expect(rendered).toContain(key);
    }
  });

  test("names what is never sent", () => {
    const rendered = frame();
    expect(rendered).toContain("Never:");
    expect(rendered).toContain("titles");
  });

  test("index 0 is keep-it-on and is marked as the default", () => {
    const rendered = frame();
    expect(rendered).toContain("Keep it on");
    expect(rendered).toContain("← default");
  });

  test("says it is on by default and how to turn it off", () => {
    const rendered = frame();
    expect(rendered).toContain("On by default");
    expect(rendered).toContain("/analytics");
  });

  test("reduced motion renders the static petal only", () => {
    const prior = process.env.KUNAI_REDUCED_MOTION;
    process.env.KUNAI_REDUCED_MOTION = "1";
    try {
      const rendered = frame();
      expect(rendered).toContain("❀");
      // Non-static bloom frames must never appear when motion is suppressed.
      expect(rendered).not.toContain("❁");
      expect(rendered).not.toContain("✾");
    } finally {
      if (prior === undefined) delete process.env.KUNAI_REDUCED_MOTION;
      else process.env.KUNAI_REDUCED_MOTION = prior;
    }
  });
});
