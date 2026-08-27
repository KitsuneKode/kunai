import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { companionFallbackGlyph, isCompanionGraphicsEnabled } from "@/app-shell/companion-policy";

const SHELL_SRC = join(import.meta.dir, "../../../src/app-shell");

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

  test("call sites mount CompanionPet so the glyph fallback can fire", () => {
    const files = ["setup/SetupFrame.tsx", "exit-shell.tsx", "shell-primitives.tsx"] as const;
    for (const file of files) {
      const src = readFileSync(join(SHELL_SRC, file), "utf8");
      expect(src, file).toContain("<CompanionPet");
      expect(src, file).not.toContain("isCompanionGraphicsEnabled");
    }
  });
});
