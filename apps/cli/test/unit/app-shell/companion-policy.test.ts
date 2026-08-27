import { describe, expect, test } from "bun:test";

import { companionFallbackGlyph, isCompanionGraphicsEnabled } from "@/app-shell/companion-policy";

describe("companion policy", () => {
  test("KUNAI_PET=0 keeps the unicode glyph path", () => {
    expect(isCompanionGraphicsEnabled({ KUNAI_PET: "0" }, { isTTY: true })).toBe(false);
    expect(isCompanionGraphicsEnabled({ KUNAI_PET: "false" }, { isTTY: true })).toBe(false);
  });

  test("KUNAI_POSTER=0 disables the pet with posters", () => {
    expect(isCompanionGraphicsEnabled({ KUNAI_POSTER: "0" }, { isTTY: true })).toBe(false);
  });

  test("non-TTY never emits a graphics pet", () => {
    expect(isCompanionGraphicsEnabled({ KITTY_WINDOW_ID: "1" }, { isTTY: false })).toBe(false);
  });

  test("tmux stays on the unicode floor", () => {
    expect(isCompanionGraphicsEnabled({ KITTY_WINDOW_ID: "1", TMUX: "1" }, { isTTY: true })).toBe(
      false,
    );
  });

  test("fallback glyph stays the portable fox", () => {
    expect(companionFallbackGlyph()).toBe("🦊");
  });
});
