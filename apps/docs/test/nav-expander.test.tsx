import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { NavExpander } from "../components/layout/nav-expander";

const css = fs.readFileSync(
  path.resolve(import.meta.dir, "../app/styles/docs-chrome.css"),
  "utf-8",
);

describe("NavExpander", () => {
  const html = renderToStaticMarkup(<NavExpander />);

  test("is a real button with a name, and starts unexpanded", () => {
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show all navigation links"');
  });

  test("carries the hook NavCompact listens for", () => {
    expect(html).toContain("data-nav-expander");
  });

  test("hides its glyph from assistive tech, since the button is already named", () => {
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("compact nav stylesheet", () => {
  test("never folds the bar on a CSS :hover of the pill: hover is the intent attribute", () => {
    // `:hover` would open the bar for the brand and the search icon, which then slide away
    // from the cursor. The rule lives in `nextNavHover` and reaches CSS as `data-nav-hover`.
    expect(css).toContain("[data-nav-hover]");
    expect(css).not.toMatch(/:not\(:hover, :has\(:focus-visible\)\)/);
  });

  test("keyboard focus opens the bar, as :focus-visible and not :focus-within", () => {
    expect(css).toContain(":has(:focus-visible)");
    expect(css).not.toContain(":has(:focus-within)");
  });

  test("the expander is a desktop control only", () => {
    const phone = css.match(
      /@media \(max-width: 767\.98px\) \{\s*\.kunai-nav-expander \{\s*display: none;/,
    );
    expect(phone).not.toBeNull();
  });

  test("the strip of header around the pill does not swallow clicks", () => {
    expect(css).toMatch(/#nd-home-layout #nd-nav \{[^}]*pointer-events: none;/);
  });

  test("the header keeps its height: only the pill inside it shrinks", () => {
    // Shrinking the header would pull the page up under it on every scroll.
    expect(css).not.toMatch(/#nd-home-layout #nd-nav \{[^}]*\n\s*height:/);
  });
});
