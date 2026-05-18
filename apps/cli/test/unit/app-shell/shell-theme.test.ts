import { describe, expect, test } from "bun:test";

import { hotkeyLabel } from "@/app-shell/shell-theme";

describe("hotkeyLabel", () => {
  test("wraps plain key in brackets", () => {
    expect(hotkeyLabel("esc")).toBe("[esc]");
    expect(hotkeyLabel("enter")).toBe("[enter]");
  });

  test("returns glyph alone when § sentinel is present", () => {
    expect(hotkeyLabel("⏭§n")).toBe("⏭");
    expect(hotkeyLabel("⏮§p")).toBe("⏮");
    expect(hotkeyLabel("↻§r")).toBe("↻");
  });
});

describe("palette", () => {
  const { palette } = require("@/app-shell/shell-theme");

  test("palette exposes purple token for series-complete milestone color", () => {
    expect(palette.purple).toBeDefined();
    expect(palette.purple).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
