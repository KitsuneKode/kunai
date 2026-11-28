import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { SetupShell } from "@/app-shell/setup-shell";
import { MPV_INSTALL } from "@/infra/os/install-commands";
import { emptyMpvHardwareAccelProbe } from "@/infra/player/mpv-hwaccel-probe";
import type { CapabilitySnapshot } from "@/ui";
import React from "react";

import { render, stripAnsi } from "../../harness/render-capture";
import { UNSET_PAYLOAD_FIXTURE } from "../../support/analytics-fixtures";

/**
 * The two first-launch screens in plain mode: selection and state are words,
 * and nothing depends on a glyph, a border or a colour to be understood.
 */

const READY: CapabilitySnapshot = {
  mpv: true,
  mpvRequired: true,
  vlc: false,
  vlcRequired: false,
  ffprobe: true,
  ytDlp: true,
  curl: { present: true, impersonates: true, profile: "chrome150" },
  image: {
    terminal: "unknown",
    protocol: "none",
    renderer: "none",
    available: false,
    reason: "test fixture",
  },
  mpvHardwareAccel: emptyMpvHardwareAccelProbe("not-probed"),
  issues: [],
};

let savedPlain: string | undefined;

beforeEach(() => {
  savedPlain = process.env.KUNAI_PLAIN;
  process.env.KUNAI_PLAIN = "1";
});

afterEach(() => {
  if (savedPlain === undefined) delete process.env.KUNAI_PLAIN;
  else process.env.KUNAI_PLAIN = savedPlain;
});

function start(snapshot: CapabilitySnapshot = READY) {
  const handle = render(
    <SetupShell
      flow="quick"
      analyticsPayload={UNSET_PAYLOAD_FIXTURE}
      snapshot={snapshot}
      finish={() => {}}
    />,
    { columns: 100, rows: 30 },
  );
  return { handle, frame: () => stripAnsi(handle.lastFrame()) };
}

const DECORATION = /[▌❀✓✗△─╭╮╰╯│🦊]/u;

describe("quick setup in plain mode", () => {
  test("the lane and the verdict are stated in words", () => {
    const { handle, frame } = start();
    try {
      expect(frame()).toContain("[selected] Shows & movies");
      expect(frame()).toContain("[ok] Ready to play in mpv");
      expect(frame()).not.toMatch(DECORATION);
    } finally {
      handle.unmount();
    }
  });

  test("a missing player is a word, not a red glyph", () => {
    const { handle, frame } = start({
      ...READY,
      mpv: false,
      issues: [
        {
          id: "mpv-missing",
          severity: "degraded",
          message: "mpv not found",
          remediation: [],
          install: MPV_INSTALL,
        },
      ],
    });
    try {
      expect(frame()).toContain("[missing] No video player found");
      expect(frame()).not.toMatch(DECORATION);
    } finally {
      handle.unmount();
    }
  });

  test("neither consent row reads as selected until an arrow is pressed", () => {
    const { handle, frame } = start();
    try {
      handle.stdin.enqueue("\r");
      expect(frame()).toContain("Share anonymous usage with Kunai?");
      expect(frame()).not.toContain("[selected]");
      handle.stdin.enqueue("\x1b[B");
      expect(frame()).toContain("[selected] Share anonymous usage");
    } finally {
      handle.unmount();
    }
  });
});
