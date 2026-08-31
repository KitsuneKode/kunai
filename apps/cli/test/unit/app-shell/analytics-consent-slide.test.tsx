import { describe, expect, test } from "bun:test";

import { SetupShell } from "@/app-shell/setup-shell";
import { AnalyticsScreen } from "@/app-shell/setup/AnalyticsScreen";
import type { CapabilitySnapshot } from "@/ui";
import React from "react";

import packageJson from "../../../package.json" with { type: "json" };
import { captureFrame, render } from "../../harness/render-capture";

/**
 * 80x24 deliberately: the smallest terminal we expect, and the size at which
 * the footer hint is first at risk of being clipped.
 */
function frame(selectedIndex = 0): string {
  return captureFrame(<AnalyticsScreen selectedIndex={selectedIndex} />, {
    columns: 80,
    rows: 24,
  });
}

const READY: CapabilitySnapshot = {
  mpv: true,
  mpvRequired: true,
  ffprobe: true,
  ytDlp: true,
  curl: { present: true, impersonates: true, profile: "chrome150" },
  image: {
    terminal: "ghostty",
    protocol: "kitty",
    renderer: "kitty-native",
    available: true,
    reason: "test fixture",
  },
  issues: [],
};

/** The whole shell, driven to the consent screen, so the frame is included. */
function consentFrameInShell(): string {
  const handle = render(<SetupShell snapshot={READY} finish={() => {}} />, {
    columns: 80,
    rows: 24,
  });
  for (let i = 0; i < 5; i += 1) handle.stdin.enqueue("\r");
  const rendered = handle.lastFrame();
  handle.unmount();
  return rendered;
}

describe("analytics consent screen", () => {
  test("offers a key that keeps analytics off without leaving setup", () => {
    // The one escape hatch that must never be lost to clipping: `s` here means
    // "keep it off", not "skip the wizard". The footer belongs to the frame
    // now, so this is asserted against the whole shell rather than the screen.
    const rendered = consentFrameInShell();
    expect(rendered).toContain("usage ping");
    expect(rendered).toContain("keep it off");
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
    // Recommending is not deciding. The screen has to state plainly that the
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

  test("carries no motion at all", () => {
    // A petal used to bloom here, under text a person is reading to make a
    // privacy decision, while the screen that actually probes the machine had
    // none. `design-system.md` warns against motion under text being read, so
    // the animation moved to the dependency screen and none belongs here.
    const rendered = frame();
    for (const bloomFrame of ["❀", "✿", "❁", "✾"]) {
      expect(rendered).not.toContain(bloomFrame);
    }
  });
});
