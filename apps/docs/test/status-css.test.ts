import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(import.meta.dir, "../app/styles/status.css"), "utf-8");
const global = fs.readFileSync(path.resolve(import.meta.dir, "../app/global.css"), "utf-8");

describe("status board stylesheet", () => {
  test("is imported by the global stylesheet", () => {
    expect(global).toContain('@import "./styles/status.css";');
  });

  test("a tooltip is out of layout until hovered, so it cannot widen the page", () => {
    // An absolutely-positioned pseudo-element counts toward scrollable overflow even at
    // `opacity: 0`: a tooltip centred on a bar near the screen edge gave a phone a
    // horizontal scrollbar. `display: none` removes it from that arithmetic.
    expect(css).toMatch(/\.kunai-strip-cell::after \{[^}]*display: none;/);
    expect(css).toMatch(/\.kunai-strip-cell:hover::after \{[^}]*display: block;/);
  });

  test("tooltips are only drawn where a pointer can hover", () => {
    const hoverBlock = css.match(/@media \(hover: hover\) \{[\s\S]*\n\}/)?.[0] ?? "";
    expect(hoverBlock).toContain("content: attr(data-tip)");
    // Nothing outside the hover query gives a bar a tooltip.
    const outside = css.replace(hoverBlock, "");
    expect(outside).not.toContain("content: attr(data-tip)");
  });

  test("the bars take their colour from the state, and a gap is hollow", () => {
    expect(css).toMatch(/\.kunai-strip-cell \{[^}]*background: var\(--status-c\);/);
    expect(css).toMatch(/\.kunai-strip-cell\[data-state="none"\] \{[^}]*background: transparent;/);
  });
});
