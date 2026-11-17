import { describe, expect, test } from "bun:test";

import { MODE_OPTIONS } from "@/app-shell/setup/SetupScreens";
import {
  AUDIO_PREFERENCE_OPTIONS,
  SUBTITLE_PREFERENCE_OPTIONS,
} from "@/domain/media/media-preferences";

import { SETUP_SCREENS, setupFrameWithAppChromeAt } from "../../harness/capture-setup";
import { stripAnsi } from "../../harness/render-capture";

const NARROW_COLS = 64;
const SHORT_ROWS = 22;

const LIBRARY_PRIMARY_LABELS = [
  "Download for offline",
  "Download quality",
  "Play the next episode automatically",
  "Skip intros",
  "Skip credits",
  "AniList",
  "TMDB",
  "Discord presence",
] as const;

const DEPS_PRIMARY_LABELS = ["mpv", "yt-dlp", "ffmpeg", "curl-impersonate", "posters"] as const;

const SCROLL_FOCUS_SCREENS = new Set(["language", "library"]);

describe("setup wizard at 64×22", () => {
  test.each(
    SETUP_SCREENS.filter((name) => !SCROLL_FOCUS_SCREENS.has(name)).map(
      (name) => [name, SETUP_SCREENS.indexOf(name)] as const,
    ),
  )("%s keeps every option primary label visible", (screen, step) => {
    const frame = setupFrameWithAppChromeAt(step, NARROW_COLS, SHORT_ROWS);
    const text = stripAnsi(frame);

    const labels: readonly string[] =
      screen === "deps"
        ? DEPS_PRIMARY_LABELS
        : screen === "mode"
          ? MODE_OPTIONS.map((option) => option.label)
          : screen === "analytics"
            ? ["Turn it on", "Keep it off"]
            : [];

    for (const label of labels) {
      expect(text, `${screen} missing “${label}”`).toContain(label);
    }
  });

  test("language shows each audio label when focused", () => {
    const step = SETUP_SCREENS.indexOf("language");
    for (const [i, option] of AUDIO_PREFERENCE_OPTIONS.entries()) {
      const frame = setupFrameWithAppChromeAt(step, NARROW_COLS, SHORT_ROWS, "\x1b[B".repeat(i));
      expect(frame).toContain(option.label);
    }
  });

  test("library shows each toggle label when focused", () => {
    const step = SETUP_SCREENS.indexOf("library");
    for (const [i, label] of LIBRARY_PRIMARY_LABELS.entries()) {
      const frame = setupFrameWithAppChromeAt(step, NARROW_COLS, SHORT_ROWS, "\x1b[B".repeat(i));
      expect(frame).toContain(label);
    }
  });

  test("analytics keeps both labels visible at each highlight", () => {
    const step = SETUP_SCREENS.indexOf("analytics");
    const onFrame = setupFrameWithAppChromeAt(step, NARROW_COLS, SHORT_ROWS);
    expect(onFrame).toContain("Turn it on");
    expect(onFrame).toContain("Keep it off");

    const offHighlighted = setupFrameWithAppChromeAt(step, NARROW_COLS, SHORT_ROWS, "\x1b[B");
    expect(offHighlighted).toContain("Turn it on");
    expect(offHighlighted).toContain("Keep it off");
  });
});
