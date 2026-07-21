import { expect, test } from "bun:test";

import { SetupShell } from "@/app-shell/setup-shell";
import type { CapabilitySnapshot } from "@/ui";
import React from "react";

import { render } from "../../harness/render-capture";

const MISSING_MPV: CapabilitySnapshot = {
  mpv: false,
  ffprobe: false,
  ytDlp: true,
  chafa: true,
  magick: true,
  image: {
    terminal: "unknown",
    protocol: "none",
    renderer: "none",
    available: false,
    dependency: "none",
    reason: "test fixture",
  },
  issues: [
    {
      id: "mpv-missing",
      severity: "degraded",
      message: "mpv not found — required for playback (shell still available).",
      remediation: ["Debian: sudo apt install mpv"],
    },
  ],
};

test("setup advances when mpv is missing", () => {
  const handle = render(<SetupShell snapshot={MISSING_MPV} finish={() => {}} />, {
    columns: 100,
    rows: 40,
  });
  try {
    handle.stdin.enqueue("\r");
    expect(handle.lastFrame()).toContain("System check");
    expect(handle.lastFrame()).toContain("continue anyway");
    handle.stdin.enqueue("\r");
    expect(handle.lastFrame()).toContain("Audio preference");
  } finally {
    handle.unmount();
  }
});
