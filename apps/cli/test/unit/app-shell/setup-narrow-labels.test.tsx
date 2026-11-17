import { describe, expect, test } from "bun:test";

import { MODE_OPTIONS } from "@/app-shell/setup/SetupScreens";
import {
  AUDIO_PREFERENCE_OPTIONS,
  SUBTITLE_PREFERENCE_OPTIONS,
} from "@/domain/media/media-preferences";

import { SETUP_SCREENS, setupFrameAt } from "../../harness/capture-setup";
import { stripAnsi } from "../../harness/render-capture";

const NARROW_COLS = 64;
const SHORT_ROWS = 22;

const LIBRARY_PRIMARY_LABELS = [
  "Download for offline",
  "Play the next episode automatically",
  "Skip intros",
  "Skip credits",
  "AniList",
  "TMDB",
  "Discord presence",
] as const;

const DEPS_PRIMARY_LABELS = ["mpv", "yt-dlp", "ffmpeg", "curl-impersonate", "posters"] as const;

describe("setup wizard at 64×22", () => {
  test.each(SETUP_SCREENS.map((name, index) => [name, index] as const))(
    "%s keeps every option primary label visible",
    (screen, step) => {
      const frame = setupFrameAt(step, NARROW_COLS, SHORT_ROWS);
      const text = stripAnsi(frame);

      const labels: readonly string[] =
        screen === "deps"
          ? DEPS_PRIMARY_LABELS
          : screen === "mode"
            ? MODE_OPTIONS.map((option) => option.label)
            : screen === "language"
              ? [
                  ...AUDIO_PREFERENCE_OPTIONS.map((option) => option.label),
                  ...SUBTITLE_PREFERENCE_OPTIONS.map((option) => option.label),
                ]
              : screen === "library"
                ? LIBRARY_PRIMARY_LABELS
                : screen === "analytics"
                  ? ["Turn it on", "Keep it off"]
                  : [];

      for (const label of labels) {
        expect(text, `${screen} missing “${label}”`).toContain(label);
      }
    },
  );
});
