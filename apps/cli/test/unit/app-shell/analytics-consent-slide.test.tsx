import { describe, expect, test } from "bun:test";

import { SetupShell } from "@/app-shell/setup-shell";
import { AnalyticsScreen } from "@/app-shell/setup/AnalyticsScreen";
import type { CapabilitySnapshot } from "@/ui";
import React from "react";

import { captureFrame, render } from "../../harness/render-capture";
import { UNSET_PAYLOAD_FIXTURE } from "../../support/analytics-fixtures";

/**
 * 80x24 deliberately: the smallest terminal we expect, and the size at which
 * the footer hint is first at risk of being clipped.
 */
function frame(selectedIndex: number | null = null, payload = UNSET_PAYLOAD_FIXTURE): string {
  return captureFrame(<AnalyticsScreen selectedIndex={selectedIndex} payload={payload} />, {
    columns: 80,
    rows: 24,
  });
}

const READY: CapabilitySnapshot = {
  mpv: true,
  mpvRequired: true,
  vlc: true,
  vlcRequired: false,
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
  const handle = render(
    <SetupShell analyticsPayload={UNSET_PAYLOAD_FIXTURE} snapshot={READY} finish={() => {}} />,
    { columns: 80, rows: 24 },
  );
  for (let i = 0; i < 4; i += 1) handle.stdin.enqueue("\r");
  const rendered = handle.lastFrame();
  handle.unmount();
  return rendered;
}

/** The selection marker `ChoiceRow` draws in front of the chosen row. */
const SELECTED = "▌";

describe("analytics consent screen", () => {
  test("offers a key that declines without leaving setup", () => {
    // The one escape hatch that must never be lost to clipping: `s` here means
    // "don't share", not "skip the wizard". The footer belongs to the frame
    // now, so this is asserted against the whole shell rather than the screen.
    const rendered = consentFrameInShell();
    expect(rendered).toContain("usage ping");
    expect(rendered).toContain("don't share");
  });

  test("pre-selects neither answer, in the shell as it opens", () => {
    // Neutral consent (decision 1 of the analytics plan): arriving on the
    // screen must not put the cursor on either choice.
    const rendered = consentFrameInShell();
    expect(rendered).toContain("Share anonymous usage");
    expect(rendered).toContain("Don't share");
    expect(rendered).not.toContain(SELECTED);
    // The negative means something only if a chosen row does draw the marker.
    expect(frame(0)).toContain(SELECTED);
  });

  test("marks neither answer as recommended", () => {
    for (const selectedIndex of [null, 0, 1]) {
      expect(frame(selectedIndex)).not.toMatch(/recommended/i);
    }
  });

  test("shows the exact payload inline, generated from describePayload()", () => {
    const rendered = frame();
    for (const [key, value] of Object.entries(UNSET_PAYLOAD_FIXTURE)) {
      expect(rendered).toContain(`"${key}": ${JSON.stringify(value)}`);
    }
  });

  test("a real payload is shown as it would be sent", () => {
    const payload = { ...UNSET_PAYLOAD_FIXTURE, id: "a".repeat(64), cohort: "2026-11" };
    const rendered = frame(null, payload);
    expect(rendered).toContain("a".repeat(40));
    expect(rendered).toContain('"cohort": "2026-11"');
  });

  test("names what is never sent", () => {
    const rendered = frame();
    expect(rendered).toContain("Never:");
    expect(rendered).toContain("titles");
  });

  test("says nothing is sent unless the user chooses to share", () => {
    expect(frame()).toContain("Nothing is sent unless you choose to share");
  });

  test("frames the count as installs rather than people", () => {
    expect(frame()).toContain("Counts installs, not people");
  });

  test("says the raw id never leaves the machine, and where to check", () => {
    const rendered = frame();
    expect(rendered).toContain("never leaves this machine");
    expect(rendered).toContain("kunai analytics log");
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
