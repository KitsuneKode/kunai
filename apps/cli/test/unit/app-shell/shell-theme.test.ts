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
  test("exposes semantic accents for the Sakura chord", () => {
    expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/i); // rose
    expect(palette.ok).toMatch(/^#[0-9a-f]{6}$/i); // mint
    expect(palette.danger).toMatch(/^#[0-9a-f]{6}$/i); // crimson
  });

  test("exposes milestone token for series-complete color", () => {
    expect(palette.milestone).toBeDefined();
    expect(palette.milestone).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("exposes surface + fill tokens", () => {
    expect(palette.raised).toMatch(/^#[0-9a-f]{6}$/i);
    expect(palette.accentFill).toMatch(/^#[0-9a-f]{6}$/i);
    expect(palette.lineStrong).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("contentTintColor", () => {
  test("maps each media kind to its type hue (Stats surface)", () => {
    expect(contentTintColor("anime")).toBe(palette.typeAnime);
    expect(contentTintColor("series")).toBe(palette.typeSeries);
    expect(contentTintColor("movie")).toBe(palette.typeMovie);
  });
});

describe("heatColor", () => {
  test("clamps the ramp index to the rose ramp", () => {
    expect(heatColor(0)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(heatColor(4)).toBe(palette.accent); // last step is the full rose
    expect(heatColor(99)).toBe(palette.accent);
    expect(heatColor(-3)).toBe(heatColor(0));
  });
});
