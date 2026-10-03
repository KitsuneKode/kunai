import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { BackToTop } from "../components/layout/back-to-top";
import { shouldCompactNav } from "../lib/nav-compact";
import { BACK_TO_TOP_AFTER_PX, isScrolledPast } from "../lib/scrolled-past";

describe("isScrolledPast", () => {
  test("is false while the sentinel is still on screen", () => {
    expect(isScrolledPast({ isIntersecting: true, top: 300 })).toBe(false);
  });

  test("is true once the sentinel has scrolled up out of view", () => {
    expect(isScrolledPast({ isIntersecting: false, top: -40 })).toBe(true);
  });

  test("is false for a sentinel below the fold: a very short viewport has not scrolled", () => {
    expect(isScrolledPast({ isIntersecting: false, top: 2400 })).toBe(false);
  });

  test("the nav and the back-to-top button use the same rule", () => {
    for (const entry of [
      { isIntersecting: true, top: 10 },
      { isIntersecting: false, top: -10 },
      { isIntersecting: false, top: 900 },
    ]) {
      expect(shouldCompactNav(entry)).toBe(isScrolledPast(entry));
    }
  });

  test("the button waits for about a screen and a half, after the nav has already folded", () => {
    expect(BACK_TO_TOP_AFTER_PX).toBeGreaterThan(300);
    expect(BACK_TO_TOP_AFTER_PX).toBeLessThan(1500);
  });
});

describe("BackToTop", () => {
  const html = renderToStaticMarkup(<BackToTop />);

  test("is a real, named button", () => {
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Back to top"');
  });

  test("starts hidden and inert, so it cannot be tabbed to or clicked while invisible", () => {
    expect(html).toContain("inert");
    expect(html).toContain("opacity-0");
    expect(html).toContain("pointer-events-none");
  });

  test("is a 44px target", () => {
    expect(html).toContain("size-11");
  });

  test("draws its scroll ring from the theme's accent, with the glyph hidden from assistive tech", () => {
    expect(html).toContain("var(--kunai-accent)");
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  test("is mounted once, in the root layout", () => {
    const layout = fs.readFileSync(path.resolve(import.meta.dir, "../app/layout.tsx"), "utf-8");
    expect(layout.match(/<BackToTop \/>/g)).toHaveLength(1);
  });
});
