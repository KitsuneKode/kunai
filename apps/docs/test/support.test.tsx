import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { HomeSupportStrip } from "../components/home/home-support-strip";
import { SiteFooter } from "../components/layout/site-footer";
import { SponsorWall } from "../components/support/sponsor-wall";
import { SPONSOR_URL, SUPPORT_PATH, sponsors, supportWays } from "../lib/support";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

describe("FUNDING.yml", () => {
  const funding = fs.readFileSync(path.join(REPO_ROOT, ".github/FUNDING.yml"), "utf-8");

  test("points GitHub's sponsor button at the same account the site links to", () => {
    const handle = new URL(SPONSOR_URL).pathname.split("/").pop();
    expect(funding).toContain(`github: [${handle}]`);
  });

  test("points its custom button at the support page", () => {
    expect(funding).toMatch(new RegExp(`custom:.*${SUPPORT_PATH}`));
  });
});

describe("SponsorWall", () => {
  test("an empty list says so and offers the action that fills it", () => {
    const html = renderToStaticMarkup(<SponsorWall sponsors={[]} />);
    expect(html).toContain("No sponsors yet");
    expect(html).toContain(SPONSOR_URL);
    expect(html).toContain('rel="noreferrer noopener"');
  });

  test("a populated list names each sponsor and links only those with a url", () => {
    const html = renderToStaticMarkup(
      <SponsorWall
        sponsors={[{ name: "Acme Anime Club", url: "https://example.test/" }, { name: "A friend" }]}
      />,
    );
    expect(html).not.toContain("No sponsors yet");
    expect(html).toContain("Acme Anime Club");
    expect(html).toContain('href="https://example.test/"');
    expect(html).toContain("A friend");
    // A sponsor with no url is plain text, never a dead link.
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  test("the committed list is what the page renders", () => {
    // Guards the declaration -> reader seam: adding a sponsor to the list must
    // be enough for them to appear, with no second place to edit.
    const html = renderToStaticMarkup(<SponsorWall sponsors={sponsors} />);
    if (sponsors.length === 0) expect(html).toContain("No sponsors yet");
    for (const sponsor of sponsors) expect(html).toContain(sponsor.name);
  });
});

describe("support entry points", () => {
  test("the home strip and the footer both reach the support page", () => {
    expect(renderToStaticMarkup(<HomeSupportStrip />)).toContain(`href="${SUPPORT_PATH}"`);
    expect(renderToStaticMarkup(<SiteFooter />)).toContain(`href="${SUPPORT_PATH}"`);
  });

  test("the home strip opens sponsorship in a new tab and says so to assistive tech", () => {
    const html = renderToStaticMarkup(<HomeSupportStrip />);
    expect(html).toContain(SPONSOR_URL);
    expect(html).toContain('target="_blank"');
    expect(html).toContain("opens GitHub Sponsors in a new tab");
  });

  test("every way to help names where it goes", () => {
    for (const way of supportWays()) {
      expect(way.href.length).toBeGreaterThan(1);
      expect(way.external).toBe(/^https?:\/\//.test(way.href));
    }
  });
});
