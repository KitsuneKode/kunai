import { expect, test } from "bun:test";

import {
  SetupShell,
  type SetupFlowResult,
  type SetupInitialState,
  type SetupPrefs,
} from "@/app-shell/setup-shell";
import type { CapabilitySnapshot } from "@/ui";
import React from "react";

import { render } from "../../harness/render-capture";

// The capture harness cannot deliver a lone escape byte in a form Ink's
// useInput resolves (see #227's own verification notes), so these drive `q`,
// which now routes through the identical requestAbort path as esc.

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

function start(initialOverrides: Partial<SetupInitialState> = {}) {
  const results: { result: SetupFlowResult; prefs: SetupPrefs; answeredScreens: number }[] = [];
  const handle = render(
    <SetupShell
      snapshot={READY}
      finish={(result, prefs, answeredScreens) => results.push({ result, prefs, answeredScreens })}
      initial={{ ...BASE_INITIAL, ...initialOverrides }}
    />,
    { columns: 100, rows: 44 },
  );
  return { handle, results };
}

test("leaving from the first screen costs nothing — no confirm (#230)", () => {
  const { handle, results } = start();
  try {
    handle.stdin.enqueue("q");
    expect(results).toHaveLength(1);
    expect(results[0]?.result).toBe("aborted");
    expect(results[0]?.answeredScreens).toBe(0);
  } finally {
    handle.unmount();
  }
});

test("past screen one, leaving asks once; another key stands down; quit re-arms (#230)", () => {
  const { handle, results } = start();
  try {
    handle.stdin.enqueue("\r"); // deps -> mode
    handle.stdin.enqueue("q");
    expect(handle.lastFrame()).toContain("Press esc again to quit");
    expect(results).toHaveLength(0);

    // Any other key stands the banner down and is consumed — it must not also
    // act, or the confirm would be a coin flip over what the stray key did.
    handle.stdin.enqueue("\r");
    expect(handle.lastFrame()).not.toContain("Press esc again to quit");
    expect(results).toHaveLength(0);

    // Leaving is still leaving: a fresh attempt asks again, predictably.
    handle.stdin.enqueue("q");
    expect(handle.lastFrame()).toContain("Press esc again to quit");
    handle.stdin.enqueue("q");
    expect(results).toHaveLength(1);
    expect(results[0]?.result).toBe("aborted");
    expect(results[0]?.answeredScreens).toBe(1);
  } finally {
    handle.unmount();
  }
});

test("[s] applies the screen's recommendation, not wherever the cursor sits (#231)", () => {
  const { handle, results } = start();
  try {
    handle.stdin.enqueue("\r"); // -> mode
    handle.stdin.enqueue("\x1b[B"); // down
    handle.stdin.enqueue("\x1b[B"); // down -> YouTube selected
    expect(handle.lastFrame()).toContain("YouTube");

    handle.stdin.enqueue("s"); // "use recommended" -> back to series, advance
    expect(handle.lastFrame()).toContain("Language");

    handle.stdin.enqueue("S"); // accept the rest and review
    expect(results).toHaveLength(0);
    expect(handle.lastFrame()).toContain("You're all set");
    handle.stdin.enqueue("\r");
    expect(results).toHaveLength(1);
    expect(results[0]?.result).toBe("defaults");
    expect(results[0]?.prefs.mode).toBe("series");
  } finally {
    handle.unmount();
  }
});

test("every pre-consent screen exposes the safe remaining-defaults shortcut", () => {
  const { handle } = start();
  try {
    handle.stdin.enqueue("\r"); // -> mode
    expect(handle.lastFrame()).toContain("[S]");
    expect(handle.lastFrame()).toContain("remaining defaults");

    handle.stdin.enqueue("\r"); // -> language
    expect(handle.lastFrame()).toContain("[S]");
    expect(handle.lastFrame()).toContain("remaining defaults");
  } finally {
    handle.unmount();
  }
});

test("[s] never flips a hydrated-on standing decision off (#231, with #228)", () => {
  const { handle, results } = start({ anilistSync: true });
  try {
    // Walk to the library screen by confirming everything before it.
    handle.stdin.enqueue("\r"); // -> mode
    handle.stdin.enqueue("\r"); // -> language
    handle.stdin.enqueue("\r"); // -> playback
    handle.stdin.enqueue("\r"); // -> library
    expect(handle.lastFrame()).toContain("Downloads & accounts");
    expect(handle.lastFrame()).toContain("AniList");

    handle.stdin.enqueue("s"); // recommended = what the user already has
    handle.stdin.enqueue("\r"); // analytics confirm (pre-selected ON)
    handle.stdin.enqueue("\r"); // done

    expect(results).toHaveLength(1);
    expect(results[0]?.prefs.connectAniList).toBe(true);
    expect(results[0]?.result).toBe("completed");
  } finally {
    handle.unmount();
  }
});

test("the focused language column names its choice's detail (#233)", () => {
  const { handle } = start();
  try {
    handle.stdin.enqueue("\r"); // -> mode
    handle.stdin.enqueue("\r"); // -> language
    // Audio column focused by default; its highlighted option is Original.
    // The detail wraps at this width, so assert a wrap-safe substring.
    expect(handle.lastFrame()).toContain("❯ Audio");
    expect(handle.lastFrame()).toContain("the title was made");
  } finally {
    handle.unmount();
  }
});

test("language profile hotkeys edit one media lane without rewriting the others", () => {
  const { handle } = start({
    languageProfiles: {
      series: { audio: "original", subtitle: "en" },
      movie: { audio: "en", subtitle: "es" },
      anime: { audio: "ja", subtitle: "none" },
      // `dub`/`interactive` — the assertion below reads their labels. Seeding a
      // value outside the option catalogs would instead exercise the raw-value
      // fallback and prove nothing about lane isolation.
      youtube: { audio: "dub", subtitle: "interactive" },
    },
  });
  try {
    handle.stdin.enqueue("\r"); // -> mode
    handle.stdin.enqueue("\r"); // -> language
    expect(handle.lastFrame()).toContain("Shows Original/English");
    expect(handle.lastFrame()).toContain("Anime Japanese/None");

    handle.stdin.enqueue("\x1b[B"); // Shows audio: Original -> English
    handle.stdin.enqueue("\t"); // Shows -> Movies
    handle.stdin.enqueue("\t"); // Movies -> Anime
    handle.stdin.enqueue("\x1b[C"); // focus subtitles
    handle.stdin.enqueue("\x1b[B"); // None -> Arabic

    const frame = handle.lastFrame();
    expect(frame).toContain("Shows English/English");
    expect(frame).toContain("Anime Japanese/Arabic");
    expect(frame).toContain("Movies English/Spanish");
    expect(frame).toContain("YouTube Any dub/Pick each time");
  } finally {
    handle.unmount();
  }
});

test("the done screen reports every media language profile", () => {
  const { handle } = start();
  try {
    handle.stdin.enqueue("\r"); // -> mode
    handle.stdin.enqueue("\r"); // -> language
    handle.stdin.enqueue("\r"); // -> playback
    handle.stdin.enqueue("\r"); // -> library
    handle.stdin.enqueue("\r"); // -> analytics
    handle.stdin.enqueue("s"); // keep analytics off -> done

    const frame = handle.lastFrame();
    expect(frame).toContain("Shows language");
    expect(frame).toContain("Movies language");
    expect(frame).toContain("Anime language");
    expect(frame).toContain("YouTube language");
  } finally {
    handle.unmount();
  }
});

test("accept-all on a fresh install asks for no account and no presence (#232)", () => {
  // The mirror of the analytics rule, for the other outward-facing controls:
  // `S` takes the recommendation, and for a standing decision nobody has made
  // yet the recommendation is "leave it alone".
  const { handle, results } = start({ anilistSync: false, tmdbSync: false });
  try {
    handle.stdin.enqueue("S");
    expect(results).toHaveLength(0);
    expect(handle.lastFrame()).toContain("You're all set");
    handle.stdin.enqueue("\r");
    expect(results).toHaveLength(1);
    expect(results[0]?.result).toBe("defaults");
    expect(results[0]?.prefs.connectAniList).toBe(false);
    expect(results[0]?.prefs.connectTmdb).toBe(false);
    expect(results[0]?.prefs.presenceDiscord).toBe(false);
  } finally {
    handle.unmount();
  }
});
