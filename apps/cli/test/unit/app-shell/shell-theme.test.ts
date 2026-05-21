import { describe, expect, test } from "bun:test";

import { contentTintColor, heatColor, hotkeyLabel, palette } from "@/app-shell/shell-theme";

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
  test("palette exposes purple token for series-complete milestone color", () => {
    expect(palette.purple).toBeDefined();
    expect(palette.purple).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("exposes new surface + fill tokens", () => {
    expect(palette.raised).toBe("#3a2f24");
    expect(palette.amberFill).toBe("#2a2012");
    expect(palette.borderStrong).toBe("#4a3d30");
  });
});

describe("contentTintColor", () => {
  test("maps each media kind to its accent", () => {
    expect(contentTintColor("anime")).toBe(palette.pink);
    expect(contentTintColor("series")).toBe(palette.info);
    expect(contentTintColor("movie")).toBe(palette.lavender);
  });
});

describe("heatColor", () => {
  test("clamps the ramp index to the amber ramp", () => {
    expect(heatColor(0)).toBe("#2a2018");
    expect(heatColor(4)).toBe("#f0a050");
    expect(heatColor(99)).toBe("#f0a050");
    expect(heatColor(-3)).toBe("#2a2018");
  });
});
