import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_THEME_ID, kunaiThemes, THEME_STORAGE_KEY, themeBootScript } from "../lib/themes";

const DOCS_APP_ROOT = path.join(__dirname, "..");
const tokensCss = fs.readFileSync(path.join(DOCS_APP_ROOT, "app/styles/tokens.css"), "utf-8");
const layoutTsx = fs.readFileSync(path.join(DOCS_APP_ROOT, "app/layout.tsx"), "utf-8");
const layoutShared = fs.readFileSync(path.join(DOCS_APP_ROOT, "lib/layout.shared.tsx"), "utf-8");
const globalCss = fs.readFileSync(path.join(DOCS_APP_ROOT, "app/global.css"), "utf-8");

describe("Kanna's coats", () => {
  test("every non-default coat has a matching data-theme block with identical hexes", () => {
    for (const theme of kunaiThemes) {
      if (theme.id === DEFAULT_THEME_ID) continue;
      const block = `html[data-theme="${theme.id}"]`;
      expect(tokensCss).toContain(block);
      const start = tokensCss.indexOf(block);
      const slice = tokensCss.slice(start, tokensCss.indexOf("}", start));
      expect(slice).toContain(`--color-fd-primary: ${theme.accent}`);
      expect(slice).toContain(`--kunai-accent-deep: ${theme.deep}`);
      expect(slice).toContain(`--kunai-accent-soft: ${theme.soft}`);
      expect(slice).toContain(`--color-fd-ring: ${theme.accent}`);
    }
  });

  test("the default coat equals :root exactly, so activating it can drop the attribute", () => {
    const sakura = kunaiThemes.find((theme) => theme.id === DEFAULT_THEME_ID)!;
    expect(tokensCss).toContain(`--color-fd-primary: ${sakura.accent}`);
    expect(tokensCss).toContain(`--kunai-accent-deep: ${sakura.deep}`);
    expect(tokensCss).toContain(`--kunai-accent-soft: ${sakura.soft}`);
    expect(tokensCss).not.toContain(`html[data-theme="${DEFAULT_THEME_ID}"]`);
  });

  test("theme ids are unique and hexes are real colours", () => {
    const ids = new Set(kunaiThemes.map((theme) => theme.id));
    expect(ids.size).toBe(kunaiThemes.length);
    for (const theme of kunaiThemes) {
      for (const hex of [theme.accent, theme.deep, theme.soft]) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  test("the accent crossfade registers the swapped properties", () => {
    for (const prop of [
      "--color-fd-primary",
      "--kunai-accent-deep",
      "--kunai-accent-soft",
      "--color-fd-ring",
    ]) {
      expect(tokensCss).toContain(`@property ${prop}`);
      expect(tokensCss).toContain(`${prop} var(--dur-panel)`);
    }
  });

  test("the glow follows the coat instead of pinning rose rgba", () => {
    expect(tokensCss).toContain(
      "--kunai-accent-glow: color-mix(in oklab, var(--kunai-accent) 10%, transparent)",
    );
    expect(tokensCss).not.toContain("--kunai-accent-glow: rgba(");
  });

  test("the boot script is inlined into the root layout and allowlists the registry", () => {
    expect(layoutTsx).toContain("themeBootScript");
    expect(themeBootScript).toContain(THEME_STORAGE_KEY);
    expect(themeBootScript).toContain("document.documentElement.dataset.theme");
    for (const theme of kunaiThemes) {
      expect(themeBootScript).toContain(theme.id);
    }
  });

  test("the cycler rides the fumadocs themeSwitch slot", () => {
    expect(layoutShared).toContain("component: <ThemeCycler />");
    expect(layoutShared).toContain("enabled: true");
  });

  test("the cycler does the orb eclipse and the view-transition circle reveal", () => {
    const source = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "components/theme/theme-cycler.tsx"),
      "utf-8",
    );
    expect(source).toContain("mask={`url(#");
    expect(source).toContain("startViewTransition");
    expect(source).toContain("::view-transition-new(root)");
    expect(source).toContain("prefers-reduced-motion");
    expect(source).toContain(THEME_STORAGE_KEY);
  });

  test("every coat declares a reveal variant the keyframe builder covers", () => {
    const source = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "components/theme/theme-cycler.tsx"),
      "utf-8",
    );
    const reveals = new Set(kunaiThemes.map((theme) => theme.reveal));
    // The point of the registry field is variety: at least two distinct
    // entrances or the field is ceremony.
    expect(reveals.size).toBeGreaterThanOrEqual(2);
    for (const reveal of reveals) {
      expect(source).toContain(`case "${reveal}"`);
    }
  });
});

describe("scroll and anchor fixes", () => {
  test("body clips horizontal overflow without becoming a scroll container", () => {
    const bodyStart = globalCss.indexOf("body {");
    const bodySlice = globalCss.slice(bodyStart, globalCss.indexOf("}", bodyStart));
    expect(bodySlice).toContain("overflow-x: clip;");
    expect(bodySlice).not.toContain("overflow-x: hidden;");
  });

  test("the hash re-anchoring fix is mounted on every route", () => {
    expect(layoutTsx).toContain("<HashScrollFix />");
    const component = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "components/layout/hash-scroll-fix.tsx"),
      "utf-8",
    );
    expect(component).toContain("scrollIntoView");
    expect(component).toContain("document.fonts");
    expect(component).toContain("usePathname");
  });

  test("short pages split the dead space instead of pooling it under the content", () => {
    const analytics = fs.readFileSync(path.join(DOCS_APP_ROOT, "app/analytics/page.tsx"), "utf-8");
    expect(analytics).toContain("justify-center");
  });

  test("back-to-top keeps its ring and gains drag-to-scrub", () => {
    const source = fs.readFileSync(
      path.join(DOCS_APP_ROOT, "components/layout/back-to-top.tsx"),
      "utf-8",
    );
    expect(source).toContain("stroke-dashoffset");
    expect(source).toContain("setPointerCapture");
    expect(source).toContain("suppressNextClick");
  });
});
