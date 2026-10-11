import { afterEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_THEME_NAME,
  THEMES,
  detectTerminalColorLevel,
  getDesignThemeName,
  isThemeName,
  listThemes,
  rawTokens,
  resolveDesignTokens,
  setDesignTheme,
  tokens,
} from "@kunai/design";

// `setDesignTheme` rewrites `tokens` at the level detection reports for this
// terminal — truecolor hex under a real one, quantised values under `bun
// test`'s pipe. Assert against the resolved expectation, never the raw hex,
// so the suite means the same thing in every environment.
const detectedLevel = detectTerminalColorLevel();
const expectedAccent = (name: keyof typeof THEMES) =>
  resolveDesignTokens(detectedLevel, THEMES[name].palette).accent;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbDistance(a: string, b: string): number {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  return Math.sqrt((pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2);
}

afterEach(() => {
  setDesignTheme(DEFAULT_THEME_NAME);
});

describe("theme registry", () => {
  test("ships every declared theme with a complete palette", () => {
    const names = listThemes().map((theme) => theme.name);
    expect(names).toContain("ember-dusk");
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const theme of listThemes()) {
      for (const key of Object.keys(rawTokens)) {
        expect(theme.palette).toHaveProperty(key);
      }
      // The heat ramp ends on the accent so Stats peaks read as the theme's
      // signature, not a borrowed hue.
      expect(theme.palette.heatRamp[4]).toBe(theme.palette.accent);
    }
  });

  test("isThemeName rejects unknown and non-string values", () => {
    expect(isThemeName("nord")).toBe(true);
    expect(isThemeName("ember-dusk")).toBe(true);
    expect(isThemeName("sakura")).toBe(false);
    expect(isThemeName(42)).toBe(false);
    expect(isThemeName(undefined)).toBe(false);
  });
});

describe("setDesignTheme live swap", () => {
  test("rewrites tokens in place — the exported object is the same, values change", () => {
    const before = tokens.accent;
    const reference = tokens;
    expect(setDesignTheme("nord")).toBe(true);
    expect(tokens).toBe(reference); // identity preserved — no re-import needed
    expect(tokens.accent).toBe(expectedAccent("nord"));
    expect(tokens.accent).not.toBe(before);
    expect(getDesignThemeName()).toBe("nord");
  });

  test("unknown names keep the active theme instead of failing", () => {
    setDesignTheme("tokyo-night");
    expect(setDesignTheme("not-a-theme")).toBe(false);
    expect(getDesignThemeName()).toBe("tokyo-night");
    expect(tokens.accent).toBe(expectedAccent("tokyo-night"));
  });
});

describe("palette-aware degradation", () => {
  test("non-default palettes keep their own accent at 256 colour", () => {
    const resolved = resolveDesignTokens("256", THEMES.nord.palette);
    // Quantized, not exact — but it must land near the theme accent, never on
    // the brand rose the curated fallback table would have produced.
    expect(rgbDistance(resolved.accent, THEMES.nord.palette.accent)).toBeLessThan(80);
    expect(resolved.accent).not.toBe(resolveDesignTokens("256").accent);
    expect(resolved.heatRamp.at(-1)).toBe(resolved.accent);
  });

  test("rgba tokens are pre-blended over the theme bg before quantizing", () => {
    const resolved = resolveDesignTokens("256", THEMES.dracula.palette);
    // accentGlow is an rgba() literal — after blending on dracula bg it must
    // resolve to a hex in the accent's hue family, not leak raw rgba text.
    expect(resolved.accentGlow).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("16-colour degradation emits ANSI names, not hex", () => {
    const resolved = resolveDesignTokens("16", THEMES["tokyo-night"].palette);
    expect(resolved.accent).not.toMatch(/^#/);
    expect(resolved.text).toBe("white");
  });

  test("default palette keeps the curated fallbacks unchanged", () => {
    const resolved = resolveDesignTokens("256");
    expect(resolved.accent).toBe("#ff87af");
  });
});
