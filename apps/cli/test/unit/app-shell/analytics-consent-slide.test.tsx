import { describe, expect, test } from "bun:test";

import { AnalyticsSlide } from "@/app-shell/setup-shell";
import React from "react";

import packageJson from "../../../package.json" with { type: "json" };
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
  test("offers a key that keeps analytics off without leaving setup", () => {
    // The one escape hatch that must never be lost to clipping: `s` here means
    // "keep it off", not "skip the wizard".
    expect(frame()).toContain("keep it off");
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

  test("leads with the recommendation and marks it as such", () => {
    const rendered = frame();
    expect(rendered).toContain("Turn it on");
    expect(rendered).toContain("← recommended");
  });

  test("still offers keeping it off, and says nothing is sent until confirmed", () => {
    // Recommending is not deciding. The slide has to state plainly that the
    // keystroke is what enables it, or a pre-selected option reads as opt-out.
    const rendered = frame();
    expect(rendered).toContain("Keep it off");
    expect(rendered).toContain("until you confirm");
  });

  test("frames the count as installs rather than people", () => {
    expect(frame()).toContain("unique installs, not people");
  });

  test("describes this machine, not a hardcoded one", () => {
    // The payload preview used to be the literal string
    // `"version": "0.3.0", "os": "linux", "arch": "x64"`, which made the one
    // screen that must be exactly true a false statement on macOS and Windows.
    //
    // Asserted as "matches the real values" rather than "is not 0.3.0": the
    // shipped version happens to be 0.3.0 today, so an absence check would pass
    // for the wrong reason now and fail for the wrong reason after a bump.
    const rendered = frame();
    expect(rendered).toContain(`"${process.platform}"`);
    expect(rendered).toContain(`"${process.arch}"`);
    expect(rendered).toContain(`"${packageJson.version}"`);
  });

  test("says the raw id never leaves the machine", () => {
    expect(frame()).toContain("never leaves this machine");
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
