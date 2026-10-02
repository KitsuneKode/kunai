import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { SiteFooter } from "../components/layout/site-footer";

/**
 * The footer is the only place the site collects every surface a reader might
 * need — docs, project pages, trust pages, and the sibling tools. The link
 * lists are data, so a typo silently drops or breaks a route nobody clicks
 * until a user does. These assertions pin the full set and the internal vs
 * external split, which is what decides `target="_blank"` and the sr-only
 * notice.
 */
function renderFooter(): string {
  return renderToStaticMarkup(<SiteFooter />);
}

describe("SiteFooter", () => {
  const html = renderFooter();

  test("links to every internal surface", () => {
    for (const href of [
      "/docs/users/getting-started",
      "/docs/users/install-and-update",
      "/docs/users/cli-reference",
      "/docs/users/troubleshooting",
      "/docs",
      "/releases",
      "/analytics",
      "/feedback",
      "/docs/users/kanna",
      "/docs/users/reliability-and-privacy",
      "/docs/users/supported-and-unsupported#disclaimer",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  test("external links open in a new tab and say so", () => {
    for (const href of [
      "https://github.com/KitsuneKode/kunai",
      "https://github.com/KitsuneKode/kunai/issues",
      "https://www.npmjs.com/package/@kitsunekode/kunai",
      "https://github.com/KitsuneKode/kittymux",
      "https://github.com/KitsuneKode/sweep",
      "https://github.com/KitsuneKode/portless",
      "https://github.com/KitsuneKode/run-cli",
      "https://github.com/KitsuneKode/arche",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain('target="_blank"');
    expect(html).toContain("opens in a new tab");
    expect(html).toContain('rel="noreferrer"');
  });

  test("internal links stay in-app (no new tab)", () => {
    const internalHrefs = [...html.matchAll(/<a [^>]*href="\/[^"]*"[^>]*>/g)].map((m) => m[0]);
    for (const tag of internalHrefs) {
      expect(tag).not.toContain('target="_blank"');
    }
  });

  test("names every link group for assistive tech", () => {
    for (const label of ["Docs", "Project", "Trust", "Also by KitsuneKode"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  test("renders the footer landmark with the Kunai home link", () => {
    expect(html).toContain("<footer");
    expect(html).toContain('aria-label="Kunai home"');
  });
});
