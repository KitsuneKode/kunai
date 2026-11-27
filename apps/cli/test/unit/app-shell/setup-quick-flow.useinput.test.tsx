import { describe, expect, test } from "bun:test";

import {
  SetupShell,
  type SetupFlowResult,
  type SetupInitialState,
  type SetupPrefs,
} from "@/app-shell/setup-shell";
import { CURL_IMPERSONATE_INSTALL, MPV_INSTALL } from "@/infra/os/install-commands";
import type { CapabilitySnapshot } from "@/ui";
import React from "react";

import { render, stripAnsi } from "../../harness/render-capture";
import { UNSET_PAYLOAD_FIXTURE } from "../../support/analytics-fixtures";
import { renderWithPointer } from "../../support/pointer-render";

/**
 * The first-launch flow, driven by real keystrokes.
 *
 * Two screens instead of six is only an improvement if nothing rode along with
 * the screens that went: the consent screen keeps every rule it had (see
 * `setup-analytics-keystroke.useinput.test.tsx` for the full flow), and the
 * settings that are no longer asked come back exactly as they were hydrated.
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
  issues: [],
};

/** Deliberately not the factory defaults, so "left alone" is distinguishable. */
const HYDRATED: SetupInitialState = {
  mode: "series",
  languageProfiles: {
    series: { audio: "en", subtitle: "none" },
    movie: { audio: "original", subtitle: "en" },
    anime: { audio: "ja", subtitle: "en" },
    youtube: { audio: "original", subtitle: "none" },
  },
  autoNext: false,
  skipIntro: true,
  skipCredits: false,
  downloadsEnabled: true,
  downloadQuality: "720p",
  anilistSync: true,
  tmdbSync: false,
  presenceDiscord: true,
};

const DOWN = "\x1b[B";
const UP = "\x1b[A";
// The capture harness cannot deliver a lone escape byte in a form Ink's
// parser accepts; `q` is the same abort key and reaches the same handler.
const QUIT = "q";
const ENTER = "\r";

type Finished = { result: SetupFlowResult; prefs: SetupPrefs; answeredScreens: number };

function start(
  options: {
    snapshot?: CapabilitySnapshot;
    columns?: number;
    rows?: number;
    onRecheck?: () => Promise<CapabilitySnapshot>;
    playerName?: string;
  } = {},
) {
  const results: Finished[] = [];
  const handle = render(
    <SetupShell
      flow="quick"
      analyticsPayload={UNSET_PAYLOAD_FIXTURE}
      snapshot={options.snapshot ?? READY}
      finish={(result, prefs, answeredScreens) => results.push({ result, prefs, answeredScreens })}
      initial={HYDRATED}
      {...(options.onRecheck ? { onRecheck: options.onRecheck } : {})}
      {...(options.playerName ? { playerName: options.playerName } : {})}
    />,
    { columns: options.columns ?? 100, rows: options.rows ?? 30 },
  );
  const frame = () => stripAnsi(handle.lastFrame());
  return { handle, results, frame };
}

describe("quick setup · two screens", () => {
  test("Enter then [s] leaves setup in two keystrokes, declining analytics", () => {
    const { handle, results, frame } = start();
    try {
      expect(frame()).toContain("setup 1⁄2");
      expect(frame()).toContain("What do you watch most?");
      expect(frame()).toContain("✓ Ready to play in mpv");

      handle.stdin.enqueue(ENTER);
      expect(frame()).toContain("setup 2⁄2");
      expect(frame()).toContain("Share anonymous usage with Kunai?");
      expect(results).toHaveLength(0);

      handle.stdin.enqueue("s");
      expect(results).toHaveLength(1);
      expect(results[0]?.result).toBe("completed");
      expect(results[0]?.prefs.analyticsChoice).toBe("disabled");
      expect(results[0]?.prefs.mode).toBe("series");
      // An engaged run: the caller may move the onboarding gate.
      expect(results[0]?.answeredScreens).toBeGreaterThan(0);
    } finally {
      handle.unmount();
    }
  });

  test("the lane under the cursor is the one written", () => {
    const { handle, results } = start();
    try {
      handle.stdin.enqueue(DOWN); // Anime
      handle.stdin.enqueue(ENTER);
      handle.stdin.enqueue("s");
      expect(results[0]?.prefs.mode).toBe("anime");
    } finally {
      handle.unmount();
    }
  });

  test("settings the two screens never showed come back exactly as hydrated", () => {
    const { handle, results } = start();
    try {
      handle.stdin.enqueue(ENTER);
      handle.stdin.enqueue("s");
      const prefs = results[0]?.prefs;
      expect(prefs?.languageProfiles).toEqual(HYDRATED.languageProfiles);
      expect(prefs?.autoNext).toBe(HYDRATED.autoNext);
      expect(prefs?.skipIntro).toBe(HYDRATED.skipIntro);
      expect(prefs?.skipCredits).toBe(HYDRATED.skipCredits);
      expect(prefs?.downloadsEnabled).toBe(HYDRATED.downloadsEnabled);
      expect(prefs?.downloadQuality).toBe(HYDRATED.downloadQuality);
      // Standing links survive: a shorter setup must not sever an account.
      expect(prefs?.connectAniList).toBe(true);
      expect(prefs?.presenceDiscord).toBe(true);
    } finally {
      handle.unmount();
    }
  });
});

describe("quick setup · the consent screen keeps its contract", () => {
  test("Enter does nothing until an arrow has chosen a row", () => {
    const { handle, results, frame } = start();
    try {
      handle.stdin.enqueue(ENTER); // -> consent
      handle.stdin.enqueue(ENTER);
      handle.stdin.enqueue(ENTER);
      expect(results).toHaveLength(0);
      expect(frame()).toContain("setup 2⁄2");
    } finally {
      handle.unmount();
    }
  });

  test("only ↓ then Enter on the share row can say enabled", () => {
    const { handle, results } = start();
    try {
      handle.stdin.enqueue(ENTER);
      handle.stdin.enqueue(DOWN); // cursor on "Share anonymous usage"
      expect(results).toHaveLength(0); // a cursor is not an answer
      handle.stdin.enqueue(ENTER);
      expect(results).toHaveLength(1);
      expect(results[0]?.prefs.analyticsChoice).toBe("enabled");
    } finally {
      handle.unmount();
    }
  });

  test("↑ then Enter lands on don't share", () => {
    const { handle, results } = start();
    try {
      handle.stdin.enqueue(ENTER);
      handle.stdin.enqueue(UP);
      handle.stdin.enqueue(ENTER);
      expect(results[0]?.prefs.analyticsChoice).toBe("disabled");
    } finally {
      handle.unmount();
    }
  });

  test("[S] and [m] choose nothing on the consent screen", () => {
    const { handle, results, frame } = start();
    try {
      handle.stdin.enqueue(ENTER);
      handle.stdin.enqueue(DOWN); // park the cursor on the share row
      handle.stdin.enqueue("S");
      handle.stdin.enqueue("m");
      handle.stdin.enqueue("p"); // the size-floor expand key, inert here too
      expect(results).toHaveLength(0);
      expect(frame()).toContain("setup 2⁄2");
    } finally {
      handle.unmount();
    }
  });

  test("[S] on the first screen only moves on — it cannot finish or opt in", () => {
    const { handle, results, frame } = start();
    try {
      handle.stdin.enqueue("S");
      expect(results).toHaveLength(0);
      expect(frame()).toContain("Share anonymous usage with Kunai?");
      handle.stdin.enqueue("S");
      expect(results).toHaveLength(0);
    } finally {
      handle.unmount();
    }
  });

  test("visiting consent, going back, and quitting records no answer", () => {
    const { handle, results, frame } = start();
    try {
      handle.stdin.enqueue(ENTER);
      handle.stdin.enqueue(DOWN); // cursor on share
      handle.stdin.enqueue("b"); // back to the first screen
      expect(frame()).toContain("What do you watch most?");
      handle.stdin.enqueue(QUIT); // asks first: something was reached
      expect(results).toHaveLength(0);
      handle.stdin.enqueue(QUIT);
      expect(results).toHaveLength(1);
      expect(results[0]?.result).toBe("aborted");
      expect(results[0]?.prefs.analyticsChoice).toBe("unchanged");
    } finally {
      handle.unmount();
    }
  });

  test("a pointer can advance the first screen but never grant consent", () => {
    let finished: Finished | undefined;
    const h = renderWithPointer(
      <SetupShell
        flow="quick"
        analyticsPayload={UNSET_PAYLOAD_FIXTURE}
        snapshot={READY}
        initial={HYDRATED}
        finish={(result, prefs, answeredScreens) => {
          finished = { result, prefs, answeredScreens };
        }}
      />,
      { columns: 100, rows: 30 },
    );
    try {
      h.click("setup:mode:1"); // Anime
      h.click("setup:action:enter");
      expect(h.lastFrame()).toContain("setup 2⁄2");
      h.click("setup:action:enter"); // must be inert
      expect(finished).toBeUndefined();
      h.click("setup:action:s"); // the labelled "don't share" key
      expect(finished?.prefs.analyticsChoice).toBe("disabled");
      expect(finished?.prefs.mode).toBe("anime");
    } finally {
      h.unmount();
    }
  });
});

describe("quick setup · leaving and widening", () => {
  test("quitting the untouched first screen leaves without an answer", () => {
    const { handle, results } = start();
    try {
      handle.stdin.enqueue(QUIT);
      expect(results).toHaveLength(1);
      expect(results[0]?.result).toBe("aborted");
      // Zero: the caller must leave the onboarding gate where it was.
      expect(results[0]?.answeredScreens).toBe(0);
    } finally {
      handle.unmount();
    }
  });

  test("[m] opens the full flow at language, and back still reaches the lane", () => {
    const { handle, results, frame } = start();
    try {
      handle.stdin.enqueue(DOWN); // Anime, so the language screen opens on it
      handle.stdin.enqueue("m");
      expect(frame()).toContain("setup 3⁄6");
      expect(frame()).toContain("Language");
      handle.stdin.enqueue("b");
      expect(frame()).toContain("setup 2⁄6");
      expect(frame()).toContain("What do you watch most?");
      expect(results).toHaveLength(0);
    } finally {
      handle.unmount();
    }
  });

  test("[d] shows the machine table in place; any key but ↑↓ r returns", () => {
    const { handle, results, frame } = start();
    try {
      handle.stdin.enqueue("d");
      expect(frame()).toContain("This machine");
      expect(frame()).toContain("curl-impersonate");
      expect(frame()).toContain("setup 1⁄2");
      handle.stdin.enqueue(DOWN); // moves the table cursor, not the lane
      expect(frame()).toContain("This machine");
      // The quit key leaves the view, not setup.
      handle.stdin.enqueue(QUIT);
      expect(results).toHaveLength(0);
      expect(frame()).toContain("What do you watch most?");
      expect(frame()).toContain("▌ Shows & movies");
    } finally {
      handle.unmount();
    }
  });
});

describe("quick setup · the machine verdict", () => {
  const NO_PLAYER: CapabilitySnapshot = {
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
  };

  test("no player names the problem and puts recheck first, and Enter still continues", () => {
    const { handle, frame } = start({ snapshot: NO_PLAYER });
    try {
      expect(frame()).toContain("✗ No video player found — nothing can play yet");
      expect(frame()).toContain("then press r. VLC works too.");
      expect(frame()).toMatch(/\[r\] recheck\s+\[enter\] continue/u);
      handle.stdin.enqueue(ENTER);
      expect(frame()).toContain("setup 2⁄2");
    } finally {
      handle.unmount();
    }
  });

  test("[r] re-probes and the verdict follows what the machine now has", async () => {
    let resolveProbe: (value: CapabilitySnapshot) => void = () => {};
    const probe = new Promise<CapabilitySnapshot>((resolve) => {
      resolveProbe = resolve;
    });
    const { handle, frame } = start({ snapshot: NO_PLAYER, onRecheck: () => probe });
    try {
      handle.stdin.enqueue("r");
      expect(frame()).toContain("Checking this machine again…");
      resolveProbe(READY);
      // The probe settles off the input path; yield to the event loop until
      // the frame reflects it rather than guessing at a tick count.
      for (let turn = 0; turn < 50 && frame().includes("Checking"); turn += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(frame()).toContain("✓ Ready to play in mpv");
      expect(frame()).not.toContain("No video player found");
    } finally {
      handle.unmount();
    }
  });

  test("a VLC session is ready and says VLC", () => {
    const { handle, frame } = start({
      snapshot: { ...READY, mpv: false, mpvRequired: false, vlc: true, vlcRequired: true },
    });
    try {
      expect(frame()).toContain("✓ Ready to play in VLC");
      expect(frame()).not.toContain("No video player");
    } finally {
      handle.unmount();
    }
  });

  test("the anime dependency appears only while Anime is highlighted", () => {
    const { handle, frame } = start({
      snapshot: {
        ...READY,
        curl: { present: true, impersonates: false, profile: null },
        issues: [
          {
            id: "curl-impersonate-missing",
            severity: "degraded",
            message: "only plain curl",
            remediation: [],
            install: CURL_IMPERSONATE_INSTALL,
          },
        ],
      },
    });
    try {
      expect(frame()).not.toContain("Anime search can come back empty");
      handle.stdin.enqueue(DOWN);
      expect(frame()).toContain("△ Anime search can come back empty here");
      handle.stdin.enqueue(DOWN); // YouTube
      expect(frame()).not.toContain("Anime search can come back empty");
    } finally {
      handle.unmount();
    }
  });
});

describe("quick setup · fits where the old flow did not", () => {
  test("at 54×25 the consent screen shows its title and both rows", () => {
    const { handle, frame } = start({ columns: 54, rows: 25 });
    try {
      handle.stdin.enqueue(ENTER);
      const lines = frame().split("\n");
      expect(frame()).toContain("Share anonymous usage with Kunai?");
      expect(frame()).toContain("Don't share");
      expect(frame()).toContain('"arch"');
      // Nothing wrapped past the frame.
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(54);
    } finally {
      handle.unmount();
    }
  });

  test("at the 40×16 floor the lanes, the verdict and both consent rows are all visible", () => {
    const { handle, frame, results } = start({ columns: 40, rows: 16 });
    try {
      for (const label of ["Shows & movies", "Anime", "YouTube", "Ready to play in mpv"]) {
        expect(frame()).toContain(label);
      }
      handle.stdin.enqueue(ENTER);
      expect(frame()).toContain("Share anonymous usage");
      expect(frame()).toContain("Don't share");
      expect(frame()).toContain("Share anonymous usage?");
      // Field names come from the payload object itself.
      expect(frame()).toContain(Object.keys(UNSET_PAYLOAD_FIXTURE).join(", "));
      for (const line of frame().split("\n")) expect(line.length).toBeLessThanOrEqual(40);

      // `p` opens the values as their own view; the answers are off screen,
      // so the keys that would answer must do nothing but close it.
      handle.stdin.enqueue("p");
      expect(frame()).toContain('"id"');
      expect(frame()).not.toContain("Don't share");
      handle.stdin.enqueue(DOWN);
      expect(frame()).toContain("Don't share");
      handle.stdin.enqueue("p");
      handle.stdin.enqueue(ENTER); // closes the view; must not confirm anything
      expect(results).toHaveLength(0);
      expect(frame()).toContain("Don't share");
    } finally {
      handle.unmount();
    }
  });
});
