import { expect, test } from "bun:test";

import { SetupShell, type SetupPrefs } from "@/app-shell/setup-shell";
import type { CapabilitySnapshot } from "@/ui";
import { Box } from "ink";
import React from "react";

import { renderWithPointer } from "../../support/pointer-render";

const ready: CapabilitySnapshot = {
  mpv: true,
  mpvRequired: true,
  ffprobe: true,
  ytDlp: true,
  curl: { present: true, impersonates: true, profile: "chrome150" },
  image: {
    terminal: "unknown",
    protocol: "none",
    renderer: "none",
    available: false,
    reason: "fixture",
  },
  issues: [],
};

test("setup pointer chooses a media profile and language, goes back, and never grants consent", () => {
  let prefs: SetupPrefs | undefined;
  const h = renderWithPointer(
    <SetupShell
      snapshot={ready}
      finish={(_outcome, value) => {
        prefs = value;
      }}
    />,
    { columns: 120, rows: 45 },
  );
  try {
    h.click("setup:action:enter");
    h.click("setup:mode:1");
    h.click("setup:action:enter");
    h.click("setup:lane:movie");
    h.click("setup:subtitle:2");
    expect(h.lastFrame()).toContain("Movies");
    h.click("setup:action:b");
    expect(h.lastFrame()).toContain("What do you watch most?");
    h.click("setup:action:enter");
    h.click("setup:action:enter");
    h.click("setup:action:enter");
    expect(h.lastFrame()).toContain("Nothing is sent until you confirm here");
    h.click("setup:action:enter");
    expect(prefs).toBeUndefined();
    h.click("setup:action:s");
    h.click("setup:action:enter");
    expect(prefs?.analyticsChoice).toBe("disabled");
    expect(prefs?.languageProfiles.movie.subtitle).toBe("none");
  } finally {
    h.unmount();
  }
});

test.each([
  [72, 24],
  [100, 30],
  [140, 40],
])("setup targets stay inside their container at %i×%i", (columns, rows) => {
  const h = renderWithPointer(
    <Box height={rows - 3} width={columns} flexDirection="column">
      <SetupShell snapshot={ready} finish={() => {}} />
    </Box>,
    { columns, rows },
  );
  try {
    for (let step = 0; step < 6; step++) {
      expect(h.lastFrame()).toContain(`setup ${step + 1}⁄6`);
      const regions = h.dispatcher
        .debugRegions()
        .filter((region) => region.id.startsWith("setup:"));
      expect(regions.length).toBeGreaterThan(0);
      for (const region of regions) {
        expect(region.rect.y + region.rect.height - 1, `${region.id} bottom`).toBeLessThanOrEqual(
          rows - 3,
        );
      }
      if (step === 3) expect(h.lastFrame()).toContain("Discord presence");
      if (step === 4) h.click("setup:action:s");
      else if (step < 5) h.click("setup:action:enter");
    }
  } finally {
    h.unmount();
  }
});

test("a setup pointer action dismisses the abort guard before navigating", () => {
  const h = renderWithPointer(<SetupShell snapshot={ready} finish={() => {}} />, {
    columns: 100,
    rows: 30,
  });
  try {
    h.click("setup:action:enter");
    h.stdin.enqueue("q");
    expect(h.lastFrame()).toContain("Press esc again");
    h.click("setup:action:b");
    expect(h.lastFrame()).not.toContain("Press esc again");
    expect(h.lastFrame()).toContain("What do you watch most?");
    h.click("setup:action:b");
    expect(h.lastFrame()).toContain("Let's get you watching");
  } finally {
    h.unmount();
  }
});
