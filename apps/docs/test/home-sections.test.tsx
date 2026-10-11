import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { HomeBento } from "../components/home/home-bento";
import { HomeOpenSource } from "../components/home/home-open-source";
import type { HomeProviderMetadata } from "../components/home/types";
import { ProjectCard } from "../components/home/workshop-showcase";
import { SiteFooter } from "../components/layout/site-footer";
import { homeHighlights } from "../lib/home-content";
import { shouldCompactNav } from "../lib/nav-compact";
import { SPONSOR_URL } from "../lib/support";
import { workshop } from "../lib/workshop";

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

describe("ProjectCard", () => {
  const sweep = workshop.find((project) => project.repo === "sweep")!;
  const meta = { stars: 12, language: "TypeScript", pushedAt: "2026-09-30T00:00:00Z" };

  test("makes the whole card one link to the project's main page, with source separate", () => {
    const html = renderToStaticMarkup(<ProjectCard project={sweep} meta={meta} />);
    expect(html).toContain(`href="${sweep.siteUrl}"`);
    expect(html).toContain("after:absolute");
    expect(html).toContain(`href="${sweep.repoUrl}"`);
  });

  test("falls back to the repository when a project has no site", () => {
    const kittymux = workshop.find((project) => project.repo === "kittymux")!;
    const html = renderToStaticMarkup(<ProjectCard project={kittymux} meta={undefined} />);
    expect(html).toContain(`href="${kittymux.repoUrl}"`);
  });

  test("prints stars at the floor and above, not below, and the update date", () => {
    expect(renderToStaticMarkup(<ProjectCard project={sweep} meta={meta} />)).toContain("12");
    const quiet = renderToStaticMarkup(
      <ProjectCard project={sweep} meta={{ ...meta, stars: 1 }} />,
    );
    expect(quiet).not.toContain("stars");
    expect(renderToStaticMarkup(<ProjectCard project={sweep} meta={meta} />)).toContain(
      "Updated Sep 30",
    );
  });

  test("opens externally and says so to assistive tech", () => {
    const html = renderToStaticMarkup(<ProjectCard project={sweep} meta={undefined} />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain("opens in a new tab");
  });
});

describe("footer workshop column", () => {
  const html = renderToStaticMarkup(<SiteFooter />);

  test("lists every curated project and never the fork", () => {
    for (const project of workshop) expect(html).toContain(project.repoUrl);
    expect(html).not.toContain("portless");
  });
});

describe("shouldCompactNav", () => {
  test("stays full size while the sentinel is on screen", () => {
    expect(shouldCompactNav({ isIntersecting: true, top: 10 })).toBe(false);
  });

  test("shrinks once the sentinel has scrolled up out of view", () => {
    expect(shouldCompactNav({ isIntersecting: false, top: -20 })).toBe(true);
  });

  test("does not shrink for a visitor who has not scrolled: a sentinel below the fold is also not intersecting", () => {
    expect(shouldCompactNav({ isIntersecting: false, top: 900 })).toBe(false);
  });
});
