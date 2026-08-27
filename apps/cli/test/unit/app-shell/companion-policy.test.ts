import { describe, expect, test } from "bun:test";

import {
  companionFallbackGlyph,
  companionMode,
  isCompanionGraphicsEnabled,
} from "@/app-shell/companion-policy";

const TTY = { isTTY: true } as const;
const PIPE = { isTTY: false } as const;
/**
 * A terminal that resolves to the kitty-native renderer without a live probe.
 *
 * `KITTY_WINDOW_ID` alone is not enough and must not be: it is inherited into
 * tmux panes, so capability detection deliberately refuses to trust the name on
 * its own. The explicit protocol is the deterministic path.
 */
const KITTY = { KITTY_WINDOW_ID: "1", KUNAI_IMAGE_PROTOCOL: "kitty" } as const;

/**
 * Capability detection reads the process's real stdout, not the one
 * `companionMode` is handed, so the graphics tier cannot be reached from a test
 * runner whose output is a pipe without flipping it for the duration.
 */
function withRealTty<T>(run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  try {
    return run();
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
    // SAFETY: with no own descriptor to restore, the property here is the
    // configurable one defined above, so deleting it returns `isTTY` to the
    // prototype lookup it had before this helper ran.
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
}

describe("companion mode", () => {
  test("KUNAI_PET retires the companion entirely", () => {
    // The way out. Before this existed `0` only dropped graphics and kept
    // emitting the glyph, so there was no way to be rid of the fox.
    for (const value of ["0", "false", "off", "none", "OFF"]) {
      expect(companionMode({ ...KITTY, KUNAI_PET: value }, TTY), value).toBe("off");
    }
  });

  test("KUNAI_PET can pin the glyph on a terminal that could host graphics", () => {
    for (const value of ["glyph", "text", "unicode"]) {
      expect(companionMode({ ...KITTY, KUNAI_PET: value }, TTY), value).toBe("glyph");
    }
  });

  test("a capable terminal gets the illustrated still", () => {
    withRealTty(() => {
      expect(companionMode(KITTY, TTY)).toBe("graphics");
      expect(isCompanionGraphicsEnabled(KITTY, TTY)).toBe(true);
    });
  });

  test("KUNAI_PET=off wins even on a terminal that could host graphics", () => {
    // The override has to sit above capability, or "off" would only mean "off
    // where it was never going to draw anyway".
    withRealTty(() => {
      expect(companionMode({ ...KITTY, KUNAI_PET: "off" }, TTY)).toBe("off");
      expect(companionMode({ ...KITTY, KUNAI_PET: "glyph" }, TTY)).toBe("glyph");
    });
  });

  test("nothing decorative reaches a pipe", () => {
    // Not "glyph": a stray emoji in redirected output is somebody's broken
    // parser, and it used to render there.
    expect(companionMode(KITTY, PIPE)).toBe("off");
    expect(companionMode({}, PIPE)).toBe("off");
  });

  test("KUNAI_POSTER=0 drops the picture but keeps the companion", () => {
    // Posters off means draw me no images. The glyph is not an image.
    expect(companionMode({ ...KITTY, KUNAI_POSTER: "0" }, TTY)).toBe("glyph");
  });

  test("tmux stays on the unicode floor", () => {
    expect(companionMode({ ...KITTY, TMUX: "1" }, TTY)).toBe("glyph");
  });

  test("a terminal with no image capability falls to the glyph, never half-block", () => {
    expect(companionMode({ TERM: "xterm" }, TTY)).toBe("glyph");
    expect(isCompanionGraphicsEnabled({ TERM: "xterm" }, TTY)).toBe(false);
  });

  test("fallback glyph stays the portable fox", () => {
    expect(companionFallbackGlyph()).toBe("🦊");
  });
});
