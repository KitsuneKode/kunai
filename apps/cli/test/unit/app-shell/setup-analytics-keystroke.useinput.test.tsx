import { expect, test } from "bun:test";

import {
  FACTORY_INITIAL_STATE,
  SETUP_LANGUAGE_LANES,
  SetupShell,
  type SetupFlowResult,
  type SetupInitialState,
  type SetupPrefs,
} from "@/app-shell/setup-shell";
import type { CapabilitySnapshot } from "@/ui";
import React from "react";

import { render, stripAnsi } from "../../harness/render-capture";

/**
 * The analytics non-negotiable, driven by real keystrokes.
 *
 * `setup-analytics-consent.test.ts` covers the same contract at the workflow
 * layer, but it injects an already-finished prefs object through
 * `forceCloseRootContent` — so it can only assert that the workflow honours
 * whatever the wizard decided, never that the wizard decides correctly. That
 * blind spot hid a real hole: consent used to be recorded when the user
 * ARRIVED on the screen, with the live cursor read at finish time, so walking
 * onto the screen, pressing left to go back, and then pressing `S` on an
 * earlier screen finished with the cursor still on the pre-selected "turn it
 * on" and opted the user in. AGENTS.md: no skip, accept-all-defaults, or
 * non-interactive path may enable analytics.
 *
 * These press the keys instead.
 */

const READY: CapabilitySnapshot = {
  mpv: true,
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
  issues: [],
};

const BASE_INITIAL: SetupInitialState = {
  mode: "series",
  languageProfiles: {
    series: { audio: "original", subtitle: "en" },
    movie: { audio: "original", subtitle: "en" },
    anime: { audio: "original", subtitle: "en" },
    youtube: { audio: "original", subtitle: "en" },
  },
  autoNext: true,
  skipIntro: true,
  skipCredits: true,
  downloadsEnabled: true,
  downloadQuality: "1080p",
  anilistSync: false,
  tmdbSync: false,
  presenceDiscord: false,
};

function start() {
  const results: { result: SetupFlowResult; prefs: SetupPrefs; answeredScreens: number }[] = [];
  const handle = render(
    <SetupShell
      snapshot={READY}
      finish={(result, prefs, answeredScreens) => results.push({ result, prefs, answeredScreens })}
      initial={BASE_INITIAL}
    />,
    { columns: 100, rows: 44 },
  );
  return { handle, results };
}

/** deps → mode → language → playback → library, by confirming each screen. */
function walkToLibrary(handle: ReturnType<typeof start>["handle"]) {
  for (let i = 0; i < 4; i++) handle.stdin.enqueue("\r");
  expect(stripAnsi(handle.lastFrame())).toContain("Downloads & accounts");
}

test("arriving on the consent screen and stepping back is not consent (#227 contract)", () => {
  const { handle, results } = start();
  try {
    walkToLibrary(handle);
    handle.stdin.enqueue("\r"); // -> analytics; cursor sits on "Turn it on"
    expect(stripAnsi(handle.lastFrame())).toContain("Turn it on");

    handle.stdin.enqueue("\x1b[D"); // left arrow — back to the library screen
    expect(stripAnsi(handle.lastFrame())).toContain("Downloads & accounts");

    // Accept-all from here. Visiting the screen must not count as answering it.
    handle.stdin.enqueue("S");
    expect(results).toHaveLength(1);
    expect(results[0]?.result).toBe("defaults");
    expect(results[0]?.prefs.analyticsChoice).toBe("unchanged");
  } finally {
    handle.unmount();
  }
});

test("the same walk-back followed by [s] never opts in either", () => {
  const { handle, results } = start();
  try {
    walkToLibrary(handle);
    handle.stdin.enqueue("\r"); // -> analytics
    handle.stdin.enqueue("\x1b[D"); // back to library
    handle.stdin.enqueue("s"); // "use recommended" on library -> analytics again
    expect(stripAnsi(handle.lastFrame())).toContain("Turn it on");

    // Still nothing decided; leaving now must leave the standing value alone.
    handle.stdin.enqueue("\x1b[D"); // back to library
    handle.stdin.enqueue("S");
    expect(results).toHaveLength(1);
    expect(results[0]?.prefs.analyticsChoice).toBe("unchanged");
  } finally {
    handle.unmount();
  }
});

test("confirming on the consent screen is what enables it", () => {
  const { handle, results } = start();
  try {
    walkToLibrary(handle);
    handle.stdin.enqueue("\r"); // -> analytics, pre-selected on
    handle.stdin.enqueue("\r"); // confirm -> done
    handle.stdin.enqueue("\r"); // finish

    expect(results).toHaveLength(1);
    expect(results[0]?.result).toBe("completed");
    expect(results[0]?.prefs.analyticsChoice).toBe("enabled");
  } finally {
    handle.unmount();
  }
});

test("[s] on the consent screen answers it — off, and it stays off", () => {
  const { handle, results } = start();
  try {
    walkToLibrary(handle);
    handle.stdin.enqueue("\r"); // -> analytics
    handle.stdin.enqueue("s"); // selects off and advances
    handle.stdin.enqueue("\r"); // finish from done

    expect(results).toHaveLength(1);
    expect(results[0]?.prefs.analyticsChoice).toBe("disabled");
  } finally {
    handle.unmount();
  }
});

test("[S] on the consent screen stops there and records off, never on", () => {
  const { handle, results } = start();
  try {
    walkToLibrary(handle);
    handle.stdin.enqueue("\r"); // -> analytics
    handle.stdin.enqueue("S"); // accept-all is not consent: off, then advance
    expect(results).toHaveLength(0); // it advanced rather than finishing
    handle.stdin.enqueue("\r"); // finish from done

    expect(results).toHaveLength(1);
    expect(results[0]?.prefs.analyticsChoice).toBe("disabled");
  } finally {
    handle.unmount();
  }
});

test("an answered screen keeps its answer when the user steps back over it", () => {
  const { handle, results } = start();
  try {
    walkToLibrary(handle);
    handle.stdin.enqueue("\r"); // -> analytics
    handle.stdin.enqueue("\x1b[B"); // move cursor to "Keep it off"
    handle.stdin.enqueue("\r"); // confirm off -> done
    handle.stdin.enqueue("\x1b[D"); // back to analytics
    handle.stdin.enqueue("\x1b[D"); // back to library
    handle.stdin.enqueue("S"); // accept-all from before the consent screen

    expect(results).toHaveLength(1);
    expect(results[0]?.prefs.analyticsChoice).toBe("disabled");
  } finally {
    handle.unmount();
  }
});

test("factory playback defaults stay off until recommended is chosen", () => {
  expect(FACTORY_INITIAL_STATE.autoNext).toBe(false);
  expect(FACTORY_INITIAL_STATE.skipIntro).toBe(false);
  expect(FACTORY_INITIAL_STATE.skipCredits).toBe(false);
});

test("language Tab and Shift+Tab cycle profiles while arrows choose audio/subtitles", () => {
  const { handle, results } = start();
  try {
    handle.stdin.enqueue(["\r", "\r"]); // deps -> mode -> language

    // Forward and reverse profile traversal must be distinct from field focus.
    handle.stdin.enqueue("\t"); // series -> movie
    handle.stdin.enqueue("\x1b[Z"); // movie -> series
    handle.stdin.enqueue("\x1b[Z"); // series -> youtube
    handle.stdin.enqueue("\x1b[B"); // choose English audio for YouTube

    // Finish without changing the remaining screens.
    handle.stdin.enqueue(["\r", "\r", "\r"]); // playback, library, analytics
    handle.stdin.enqueue("s"); // consent: explicitly keep analytics off
    handle.stdin.enqueue("\r"); // done

    expect(results).toHaveLength(1);
    expect(results[0]?.prefs.languageProfiles.youtube.audio).toBe("en");
    expect(results[0]?.prefs.languageProfiles.series.audio).toBe("original");
    expect(results[0]?.prefs.languageProfiles.movie.audio).toBe("original");
  } finally {
    handle.unmount();
  }
});

test("language apply-to-all copies the active profile without touching playback", () => {
  const { handle, results } = start();
  try {
    handle.stdin.enqueue(["\r", "\r"]); // deps -> mode -> language
    handle.stdin.enqueue("\x1b[B"); // series audio: English
    handle.stdin.enqueue("a"); // copy series profile to every lane
    handle.stdin.enqueue(["\r", "\r", "\r"]); // playback, library, analytics
    handle.stdin.enqueue("s");
    handle.stdin.enqueue("\r");

    expect(results).toHaveLength(1);
    for (const lane of SETUP_LANGUAGE_LANES) {
      expect(results[0]?.prefs.languageProfiles[lane.value].audio).toBe("en");
    }
    expect(results[0]?.prefs.autoNext).toBe(true); // explicit BASE_INITIAL remains hydrated
  } finally {
    handle.unmount();
  }
});
