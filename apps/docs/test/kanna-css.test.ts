import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(import.meta.dir, "../app/styles/fox.css"), "utf-8");

describe("Kanna's touch and carry styling", () => {
  test("a finger that starts on her drags her instead of scrolling or selecting", () => {
    expect(css).toMatch(/\.kunai-roamer__fox \{[^}]*touch-action: none;/);
    expect(css).toMatch(/\.kunai-roamer__fox \{[^}]*user-select: none;/);
  });

  test("the dismiss control is always shown on a touch screen, where there is no hover to reveal it", () => {
    const coarse = css.match(/@media \(pointer: coarse\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(coarse).toContain(".kunai-roamer__close");
    expect(coarse).toMatch(/opacity: 1;/);
  });

  test("the dismiss control is thumb-sized on touch", () => {
    const coarse = css.match(/@media \(pointer: coarse\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(coarse).toMatch(/width: 1\.75rem;/);
  });

  test("being carried turns off her easing, so she follows the hand exactly", () => {
    expect(css).toMatch(/\.kunai-roamer__fox\.is-carried \{[^}]*transition: none;/);
  });

  test("her bubble opens inward near a side of the window so it is never cut off", () => {
    expect(css).toContain('.kunai-roamer__bubble[data-side="left"]');
    expect(css).toContain('.kunai-roamer__bubble[data-side="right"]');
  });

  test("she is still removed entirely under reduced motion, on every device", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.kunai-roamer \{[^}]*display: none;/,
    );
  });
});
