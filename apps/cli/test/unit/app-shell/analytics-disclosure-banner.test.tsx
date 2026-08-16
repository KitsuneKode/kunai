import { describe, expect, test } from "bun:test";

import { AnalyticsDisclosureBanner } from "@/app-shell/AnalyticsDisclosureBanner";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

function frame(): string {
  return captureFrame(<AnalyticsDisclosureBanner width={74} />, { columns: 80, rows: 24 });
}

describe("analytics disclosure banner", () => {
  test("recommends opt-in without claiming that analytics is enabled", () => {
    const rendered = frame();
    expect(rendered).toContain("not enabled");
    expect(rendered).toContain("opt-in");
    expect(rendered).toContain("Settings");
    expect(rendered).toContain("disable");
  });

  test("lists every payload field", () => {
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

  test("fits an 80-column terminal without wrapping a line off the frame", () => {
    for (const line of frame().split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });
});
