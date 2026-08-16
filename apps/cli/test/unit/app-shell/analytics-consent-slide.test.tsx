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
  test("states that skipping keeps analytics off", () => {
    expect(frame()).toContain("skip (keeps it off)");
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

  test("index 0 keeps analytics off and is marked as the default", () => {
    const rendered = frame();
    expect(rendered).toContain("Keep analytics off");
    expect(rendered).toContain("← default");
  });

  test("requires an explicit choice to turn analytics on", () => {
    const rendered = frame();
    expect(rendered).toContain("Off by default");
    expect(rendered).toContain("Turn on analytics");
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
