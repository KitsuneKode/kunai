import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { HomeBento } from "../components/home/home-bento";
import { HomeOpenSource } from "../components/home/home-open-source";
import type { HomeProviderMetadata } from "../components/home/types";
import { SiteFooter } from "../components/layout/site-footer";
import { ToolRow } from "../components/workshop/tool-row";
import { WorkshopCard } from "../components/workshop/workshop-card";
import { homeHighlights } from "../lib/home-content";
import { SPONSOR_URL } from "../lib/support";
import { primaryUrl, workshop } from "../lib/workshop";

function providers(count: number): HomeProviderMetadata[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    displayName: `Provider ${index}`,
    description: "",
    domain: "example.test",
    recommended: index === 3,
    mediaKinds: ["series"],
    capabilities: [],
    status: "active",
    notes: [],
  }));
}

describe("HomeBento", () => {
  const html = renderToStaticMarkup(
    <HomeBento highlights={homeHighlights} providers={providers(12)} />,
  );

  test("states the real provider count and names providers instead of listing a feature", () => {
    expect(html).toContain(">12<");
    expect(html).toContain("Provider 3");
    expect(html).toContain("+4 more");
  });

  test("puts the recommended provider first", () => {
    expect(html.indexOf("Provider 3")).toBeLessThan(html.indexOf("Provider 0"));
  });

  test("carries all four highlights, in two sizes of tile", () => {
    for (const item of homeHighlights) expect(html).toContain(item.label);
    expect(html).toContain("md:col-span-7");
    expect(html).toContain("md:col-span-5");
  });

  test("shows the recovery commands the docs actually name", () => {
    for (const command of ["/recover", "/fallback", "/diagnostics"])
      expect(html).toContain(command);
  });

  test("ships no client JavaScript: it is plain server markup", () => {
    expect(html).not.toContain("<script");
  });
});

describe("HomeOpenSource", () => {
  const html = renderToStaticMarkup(<HomeOpenSource />);

  test("offers the free ways to help before the paid one", () => {
    expect(html.indexOf("Report a broken provider")).toBeLessThan(html.indexOf("Sponsors"));
    expect(html).toContain("good+first+issue");
  });

  test("credits the maintainer by name and links the profile", () => {
    expect(html).toContain("https://github.com/KitsuneKode");
    expect(html).toContain("KitsuneKode");
  });

  test("offers sponsorship exactly once: the wall's own button is off here", () => {
    expect(html.split(SPONSOR_URL).length - 1).toBe(1);
    expect(html).not.toContain("Be the first");
  });

  test("does not fake a contributor wall", () => {
    expect(html).not.toContain("Contributors");
  });
});

describe("WorkshopCard", () => {
  const byRepo = new Map(workshop.map((project) => [project.repo, project]));
  const kyma = byRepo.get("kyma")!;
  const kittymux = byRepo.get("kittymux")!;
  const meta = { stars: 12, language: "TypeScript", pushedAt: "2026-09-30T00:00:00Z" };

  test("makes the whole card one link to the project's main page, with source separate", () => {
    const html = renderToStaticMarkup(<WorkshopCard project={kyma} meta={meta} />);
    expect(html).toContain(`href="${kyma.siteUrl}"`);
    expect(html).toContain("after:absolute");
    expect(html).toContain(`href="${kyma.repoUrl}"`);
  });

  test("shows a bundled screenshot of the site, with a size so the page does not jump", () => {
    const html = renderToStaticMarkup(<WorkshopCard project={kyma} meta={meta} />);
    expect(html).toContain('src="/workshop/kyma.webp"');
    expect(html).toContain('width="1200"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("The Kyma home page");
  });

  test("never requests a picture from anyone else's host", () => {
    for (const project of workshop) {
      const html = renderToStaticMarkup(<WorkshopCard project={project} meta={undefined} />);
      const sources = [...html.matchAll(/src="([^"]+)"/g)].map((match) => match[1]);
      for (const source of sources) expect(source?.startsWith("/")).toBe(true);
    }
  });

  test("a project with no site gets a typographic tile, not a fabricated picture", () => {
    const html = renderToStaticMarkup(<WorkshopCard project={kittymux} meta={undefined} />);
    expect(html).not.toContain("<img");
    expect(html).toContain(`href="${kittymux.repoUrl}"`);
  });

  test("the home card carries the tagline and the page card the longer summary", () => {
    expect(renderToStaticMarkup(<WorkshopCard project={kyma} meta={meta} compact />)).toContain(
      kyma.tagline,
    );
    expect(renderToStaticMarkup(<WorkshopCard project={kyma} meta={meta} />)).toContain(
      kyma.summary,
    );
  });

  test("prints stars at the floor and above, not below, and the update date", () => {
    expect(renderToStaticMarkup(<WorkshopCard project={kyma} meta={meta} />)).toContain("12");
    const quiet = renderToStaticMarkup(
      <WorkshopCard project={kyma} meta={{ ...meta, stars: 1 }} />,
    );
    expect(quiet).not.toContain("stars");
    expect(renderToStaticMarkup(<WorkshopCard project={kyma} meta={meta} />)).toContain(
      "Updated Sep 30",
    );
  });

  test("opens externally and says so to assistive tech", () => {
    const html = renderToStaticMarkup(<WorkshopCard project={kyma} meta={undefined} />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain("opens in a new tab");
  });
});

describe("ToolRow", () => {
  const sweep = workshop.find((project) => project.repo === "sweep")!;

  test("goes to the project's page, keeps the source link separate, and says what it is", () => {
    const html = renderToStaticMarkup(<ToolRow project={sweep} meta={undefined} />);
    expect(html).toContain(`href="${sweep.siteUrl}"`);
    expect(html).toContain(`href="${sweep.repoUrl}"`);
    expect(html).toContain(sweep.summary);
    expect(html).toContain("CLI");
  });
});

describe("footer workshop column", () => {
  const html = renderToStaticMarkup(<SiteFooter />);

  test("names every curated project and never the fork", () => {
    for (const project of workshop) expect(html).toContain(`href="${primaryUrl(project)}"`);
    expect(html).not.toContain("portless");
  });
});
