import { afterEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_THEME_NAME,
  THEMES,
  apcaContrastLc,
  detectTerminalColorLevel,
  getDesignThemeName,
  isThemeName,
  listThemes,
  rawTokens,
  resolveDesignTokens,
  setDesignTheme,
  tokens,
  wcagContrastRatio,
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
    expect(isThemeName("")).toBe(false);
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

  test("light themes quantize dark text to black and light canvas to white on 16 colors", () => {
    for (const name of ["paper-sakura", "high-contrast-light"] as const) {
      const resolved = resolveDesignTokens("16", THEMES[name].palette);
      expect(resolved.bg).toBe("white");
      expect(resolved.text).toBe("black");
    }
  });
});

describe("accessible light and high-contrast themes", () => {
  const SURFACES = ["bg", "surface", "surfaceElevated", "surfaceActive", "accentFill"] as const;
  const CONTROL_SURFACES = ["bg", "surface", "surfaceElevated"] as const;
  const READABLE_TEXT_TOKENS = [
    "text",
    "textDim",
    "muted",
    "accent",
    "accentSoft",
    "ok",
    "warn",
    "dangerText",
    "info",
    "milestoneText",
  ] as const;

  test("registry ships both light and high-contrast themes selectable by id", () => {
    const all = listThemes();
    expect(all.some((theme) => theme.appearance === "light")).toBe(true);
    expect(all.some((theme) => theme.contrast === "high")).toBe(true);
    expect(isThemeName("paper-sakura")).toBe(true);
    expect(isThemeName("high-contrast-dark")).toBe(true);
    expect(isThemeName("high-contrast-light")).toBe(true);
    expect(THEMES["paper-sakura"].appearance).toBe("light");
    expect(THEMES["high-contrast-dark"].contrast).toBe("high");
    expect(THEMES["high-contrast-light"].appearance).toBe("light");
    expect(THEMES["high-contrast-light"].contrast).toBe("high");
  });

  test("Paper Sakura (light) clears WCAG AA (>= 4.5:1) and APCA body/label floors", () => {
    const p = THEMES["paper-sakura"].palette;
    for (const token of READABLE_TEXT_TOKENS) {
      for (const surface of SURFACES) {
        const wcag = wcagContrastRatio(p[token], p[surface]);
        const apca = Math.abs(apcaContrastLc(p[token], p[surface]));
        expect(wcag, `paper-sakura ${token} on ${surface} WCAG`).toBeGreaterThanOrEqual(4.5);
        expect(apca, `paper-sakura ${token} on ${surface} APCA`).toBeGreaterThanOrEqual(57);
      }
    }
    expect(Math.abs(apcaContrastLc(p.text, p.bg))).toBeGreaterThanOrEqual(90);
    expect(Math.abs(apcaContrastLc(p.textDim, p.bg))).toBeGreaterThanOrEqual(75);
    expect(Math.abs(apcaContrastLc(p.dim, p.bg))).toBeGreaterThanOrEqual(45);
    for (const surface of CONTROL_SURFACES) {
      expect(
        wcagContrastRatio(p.lineControl, p[surface]),
        `paper-sakura lineControl on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test.each(["high-contrast-dark", "high-contrast-light"] as const)(
    "%s clears WCAG AAA (>= 7:1) for text/status and >= 4.5:1 for dim text and controls",
    (themeName) => {
      const p = THEMES[themeName].palette;
      for (const token of READABLE_TEXT_TOKENS) {
        for (const surface of SURFACES) {
          const wcag = wcagContrastRatio(p[token], p[surface]);
          const apca = Math.abs(apcaContrastLc(p[token], p[surface]));
          expect(wcag, `${themeName} ${token} on ${surface} WCAG AAA`).toBeGreaterThanOrEqual(7);
          expect(apca, `${themeName} ${token} on ${surface} APCA`).toBeGreaterThanOrEqual(60);
        }
      }
      expect(wcagContrastRatio(p.text, p.bg)).toBeCloseTo(21, 1);
      for (const surface of CONTROL_SURFACES) {
        expect(
          wcagContrastRatio(p.dim, p[surface]),
          `${themeName} dim on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          wcagContrastRatio(p.lineControl, p[surface]),
          `${themeName} lineControl on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
