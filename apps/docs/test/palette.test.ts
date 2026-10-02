import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const STYLES = path.resolve(import.meta.dir, "../app/styles");
const tokensCss = fs.readFileSync(path.join(STYLES, "tokens.css"), "utf-8");
const chromeCss = fs.readFileSync(path.join(STYLES, "docs-chrome.css"), "utf-8");
const typographyCss = fs.readFileSync(path.join(STYLES, "typography.css"), "utf-8");

function cssVar(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`${name} is not a hex colour in the stylesheet`);
  return match[1];
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function ratio(a: string, b: string): number {
  const [first, second] = [luminance(a), luminance(b)];
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const SURFACES = ["--color-fd-background", "--color-fd-card", "--color-fd-popover"] as const;

describe("docs palette contrast floors", () => {
  test("muted text reads at 4.5:1 on every docs surface", () => {
    const muted = cssVar(tokensCss, "--color-fd-muted-foreground");
    for (const surface of SURFACES) {
      expect(
        ratio(muted, cssVar(tokensCss, surface)),
        `muted on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("control borders are a 3:1 edge on every docs surface", () => {
    const edge = cssVar(tokensCss, "--kunai-line-control");
    for (const surface of SURFACES) {
      expect(ratio(edge, cssVar(tokensCss, surface)), `edge on ${surface}`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  test("`border-input` resolves to the control border, not the decorative divider", () => {
    const global = fs.readFileSync(path.resolve(STYLES, "../global.css"), "utf-8");
    expect(global).toMatch(/--color-input:\s*var\(--kunai-line-control\)/);
  });
});

describe("code-block comments", () => {
  const HIGHLIGHTER_COMMENT = "#6A737D";

  test("the highlighter's own comment colour fails body contrast on the code surface", () => {
    // This is the number that justified the override. If it ever passes (the theme
    // changed), the override below is dead weight and should be deleted.
    expect(ratio(HIGHLIGHTER_COMMENT, cssVar(tokensCss, "--color-fd-card"))).toBeLessThan(4.5);
  });

  test("comments are re-pointed at the muted token, which passes", () => {
    expect(chromeCss).toContain('span[style*="--shiki-dark: #6A737D"]');
    expect(chromeCss).toMatch(/--shiki-dark:\s*var\(--color-fd-muted-foreground\)\s*!important/);
  });
});

describe("type scale", () => {
  test("body-level text never goes below the 12px caption floor", () => {
    expect(tokensCss).toContain("--kunai-text-caption: 0.75rem");
  });

  test("weights come from the four-name scale, never raw 700 or 900", () => {
    const sources = [
      "home.css",
      "surfaces.css",
      "docs-chrome.css",
      "typography.css",
      "fox.css",
      "timeline.css",
    ]
      .map((file) => fs.readFileSync(path.join(STYLES, file), "utf-8"))
      .join("\n");
    expect(sources).not.toMatch(/font-weight:\s*(700|800|900)\b/);
    expect(typographyCss).toContain("var(--kunai-weight-display)");
  });
});
