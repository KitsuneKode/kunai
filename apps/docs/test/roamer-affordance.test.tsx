import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { KunaiFoxRoamer } from "../components/brand/kunai-fox-roamer";

const FOX_CSS = path.join(import.meta.dir, "../app/styles/fox.css");

type CssRule = { readonly selector: string; readonly body: string };

/**
 * Flatten a stylesheet to its plain rules.
 *
 * `@keyframes` bodies are dropped rather than descended into: a `0%` step is a
 * moment in an animation, not a state anything can be clicked in, and the whole
 * point of the check below is which states are clickable. `@media` bodies are
 * descended into, because a rule inside one is a real rule.
 */
function flattenRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let prelude = "";
  let index = 0;

  while (index < css.length) {
    const character = css[index];

    if (character === "{") {
      let depth = 1;
      let cursor = index + 1;
      while (cursor < css.length && depth > 0) {
        if (css[cursor] === "{") depth += 1;
        else if (css[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      const body = css.slice(index + 1, cursor - 1);
      const selector = prelude.replace(/\/\*[\s\S]*?\*\//g, "").trim();

      if (selector.startsWith("@media")) rules.push(...flattenRules(body));
      else if (!selector.startsWith("@")) rules.push({ selector, body });

      prelude = "";
      index = cursor;
      continue;
    }

    if (character === "}") {
      prelude = "";
      index += 1;
      continue;
    }

    prelude += character;
    index += 1;
  }

  return rules;
}

function declares(body: string, property: string, value: string): boolean {
  return new RegExp(`(^|;|\\*/)\\s*${property}\\s*:\\s*${value}\\s*(;|$)`).test(body);
}

/**
 * Rules that hide a roamer element without also making it unclickable.
 *
 * This is the shape of the bug that took Kanna off the deployed site: the
 * dismiss button was `opacity: 0` with live pointer events, an 18px invisible
 * target sitting over the ear you are invited to click, and one stray click
 * retired her permanently in that browser. The guard is written against the
 * class rather than that one selector so the next transparent control in this
 * subtree cannot reintroduce it.
 */
function invisibleButClickable(css: string): string[] {
  return flattenRules(css)
    .filter((rule) => rule.selector.includes(".kunai-roamer"))
    .filter((rule) => declares(rule.body, "opacity", "0"))
    .filter((rule) => !declares(rule.body, "pointer-events", "none"))
    .map((rule) => rule.selector);
}

describe("roamer dismiss affordance", () => {
  const css = fs.readFileSync(FOX_CSS, "utf-8");

  test("nothing in the roamer is transparent and still clickable", () => {
    expect(invisibleButClickable(css)).toEqual([]);
  });

  test("the guard actually catches the shape it is written against", () => {
    // Without this the test above passes just as happily against a stylesheet
    // the checker cannot read at all.
    const regression = `
      .kunai-roamer__close {
        position: absolute;
        pointer-events: auto;
        opacity: 0;
        transition: opacity 160ms ease-out;
      }
    `;
    expect(invisibleButClickable(regression)).toEqual([".kunai-roamer__close"]);
  });

  test("the dismiss button becomes clickable exactly when it becomes visible", () => {
    const reveal = flattenRules(css).find(
      (rule) => rule.selector === ".kunai-roamer:hover .kunai-roamer__close",
    );
    expect(reveal).toBeDefined();
    expect(declares(reveal?.body ?? "", "opacity", "1")).toBe(true);
    expect(declares(reveal?.body ?? "", "pointer-events", "auto")).toBe(true);
  });

  test("the undo is not swept up by the reduced-motion floor that hides her", () => {
    // She is motion and is removed under reduced motion; the undo is a control
    // and must survive, or the query flipping between the dismissing click and
    // this rule would put the one-way door straight back.
    const hidden = flattenRules(css)
      .filter((rule) => declares(rule.body, "display", "none"))
      .map((rule) => rule.selector);
    expect(hidden).toContain(".kunai-roamer");
    expect(hidden).not.toContain(".kunai-roamer-undo");
  });
});

describe("roamer server render", () => {
  test("renders nothing, so there is no hydration mismatch to reconcile", () => {
    // `app/layout.tsx` mounts her as a direct child of <body> and states this
    // as the reason it is safe under every rendering mode the site uses.
    expect(renderToStaticMarkup(<KunaiFoxRoamer />)).toBe("");
  });
});
