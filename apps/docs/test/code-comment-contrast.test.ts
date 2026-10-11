import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(
  path.resolve(import.meta.dir, "../app/styles/docs-chrome.css"),
  "utf-8",
);

/** The rule that lifts code comments off the highlighter's 3.7:1 grey. */
function commentRuleSelector(): string {
  const match = css.match(/(#nd-docs-layout pre span\[[^\]]*\])\s*\{/);
  if (!match?.[1]) throw new Error("comment contrast rule not found in docs-chrome.css");
  return match[1];
}

/** Does a `[style*="needle"]` attribute selector, with an optional `i` flag, match this attribute? */
function matches(selector: string, style: string): boolean {
  const attr = selector.match(/\[style\*="([^"]+)"(\s+i)?\]/);
  if (!attr?.[1]) throw new Error(`not a substring attribute selector: ${selector}`);
  const needle = attr[1];
  return attr[2] ? style.toLowerCase().includes(needle.toLowerCase()) : style.includes(needle);
}

describe("code comment contrast override", () => {
  const selector = commentRuleSelector();

  test("matches the style attribute exactly as the server writes it, with no space after the colon", () => {
    // Lighthouse read this from the served HTML: the override missed it and the
    // comments stayed at 3.7:1, failing color-contrast on every page with a code block.
    expect(matches(selector, "--shiki-light:#6A737D;--shiki-dark:#6A737D")).toBe(true);
  });

  test("matches the spaced form the browser's CSSOM reports, and a lower-case hex", () => {
    expect(matches(selector, "--shiki-light: #6A737D; --shiki-dark: #6A737D")).toBe(true);
    expect(matches(selector, "--shiki-dark:#6a737d")).toBe(true);
  });

  test("does not touch other token colours", () => {
    expect(matches(selector, "--shiki-light:#D73A49;--shiki-dark:#F97583")).toBe(false);
  });
});
