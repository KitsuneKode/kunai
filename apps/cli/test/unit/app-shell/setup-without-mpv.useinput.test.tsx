import { expect, test } from "bun:test";

import { SetupShell } from "@/app-shell/setup-shell";
import {
  buildRemediationLines,
  MPV_INSTALL,
  resolveInstallCommand,
} from "@/infra/os/install-commands";
import type { CapabilitySnapshot } from "@/ui";
import React from "react";

import { render } from "../../harness/render-capture";

const MISSING_MPV: CapabilitySnapshot = {
  mpv: false,
  ffprobe: false,
  ytDlp: true,
  curl: { present: true, impersonates: true, profile: "chrome150" },
  image: {
    terminal: "unknown",
    protocol: "none",
    renderer: "none",
    available: false,
    reason: "test fixture",
  },
  issues: [
    {
      id: "mpv-missing",
      severity: "degraded",
      message: "mpv not found — required for playback (shell still available).",
      install: MPV_INSTALL,
      remediation: buildRemediationLines(MPV_INSTALL),
    },
  ],
};

test("setup advances when mpv is missing", () => {
  // Missing mpv degrades rather than blocks: browsing, the watchlist, and the
  // calendar all work without it, so refusing to continue would be a lie about
  // what is actually broken.
  const handle = render(<SetupShell snapshot={MISSING_MPV} finish={() => {}} />, {
    columns: 100,
    rows: 40,
  });
  try {
    const deps = handle.lastFrame();
    expect(deps).toContain("mpv");
    expect(deps).toContain("Nothing can play until this is installed.");
    // Degraded, not blocking — a crimson ✗ would overstate it.
    expect(deps).toContain("△");

    handle.stdin.enqueue("\r");
    expect(handle.lastFrame()).toContain("What do you watch most?");
    handle.stdin.enqueue("\r");
    expect(handle.lastFrame()).toContain("Language");
  } finally {
    handle.unmount();
  }
});

test("the dependency screen shows one install command for this machine", () => {
  const handle = render(<SetupShell snapshot={MISSING_MPV} finish={() => {}} />, {
    columns: 100,
    rows: 40,
  });
  try {
    // Not shown until asked: the screen's job is the state of the machine, and
    // five platforms' worth of commands at once buried the one that applied.
    const expected = resolveInstallCommand(MPV_INSTALL);
    expect(expected).not.toBeNull();
    expect(handle.lastFrame()).not.toContain(expected as string);

    handle.stdin.enqueue("d");
    const withFix = handle.lastFrame();
    expect(withFix).toContain("Install mpv on this machine");
    // Whatever this machine would actually run — asserted through the resolver
    // rather than a literal, so the test is not pinned to one developer's distro.
    expect(withFix).toContain(expected as string);
    // And only that one. Every other platform's command stays out of the way.
    for (const other of buildRemediationLines(MPV_INSTALL)) {
      const command = other.slice(8).trim();
      if (command && command !== expected) expect(withFix).not.toContain(command);
    }
  } finally {
    handle.unmount();
  }
});
