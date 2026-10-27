import { describe, expect, test } from "bun:test";

import { Children, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import HomePageShell from "../app/(home)/home-page-shell";
import HomePage from "../app/(home)/page";
import { HeroProofRow } from "../components/home/hero-proof-row";
import { softwareApplicationJsonLd } from "../lib/json-ld";
import { buildPageMetadata, docsOgImagePath } from "../lib/page-metadata";
import { latestReleaseNotesArtifact } from "../lib/release-notes";

describe("softwareApplicationJsonLd", () => {
  const app = softwareApplicationJsonLd({ version: "1.2.3", description: "A terminal client." });

  test("describes a free installable app with its platforms and licence", () => {
    expect(app["@type"]).toBe("SoftwareApplication");
    expect(app.isAccessibleForFree).toBe(true);
    expect(app.offers.price).toBe("0");
    expect(app.operatingSystem).toContain("Linux");
    expect(app.license).toContain("LICENSE");
  });

  test("hands a crawler the same card a person would see", () => {
    expect(app.image).toMatch(/\/opengraph-image$/);
  });

  test("connects the project's own pages as one entity", () => {
    expect(app.author.sameAs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("github.com/KitsuneKode/kunai"),
        expect.stringContaining("npmjs.com/package/@kitsunekode/kunai"),
      ]),
    );
  });

  test("never invents a rating", () => {
    expect(JSON.stringify(app)).not.toContain("aggregateRating");
    expect(JSON.stringify(app)).not.toContain("review");
  });

  test("names the app category, OS set, version, and download channel", () => {
    expect(app.applicationCategory).toBe("MultimediaApplication");
    expect(app.operatingSystem).toBe("Linux, macOS, Windows");
    expect(app.softwareVersion).toBe("1.2.3");
    expect(app.downloadUrl).toBe("https://github.com/KitsuneKode/kunai/releases/latest");
  });

  test("carries no SearchAction — the site has no HTML search endpoint", () => {
    expect(JSON.stringify(app)).not.toContain("SearchAction");
  });

  test("omits an unknown public version instead of implying a source build is downloadable", () => {
    expect(softwareApplicationJsonLd({ description: "A terminal client." })).not.toHaveProperty(
      "softwareVersion",
    );
  });

  test("home application schema matches the release available from its latest download link", () => {
    const blocks = Children.toArray(HomePage().props.children);
    const script = blocks.find((block) => isValidElement(block) && block.type === "script");
    if (!isValidElement<{ dangerouslySetInnerHTML: { __html: string } }>(script)) {
      throw new Error("Home page has no structured data script");
    }
    // SAFETY: HomePage authors this array; the assertions below locate and check its app record.
    const schema = JSON.parse(script.props.dangerouslySetInnerHTML.__html) as Array<{
      "@type": string;
      softwareVersion?: string;
      downloadUrl?: string;
    }>;
    const application = schema.find((item) => item["@type"] === "SoftwareApplication");
    expect(application).toBeDefined();
    expect(application?.downloadUrl).toBe("https://github.com/KitsuneKode/kunai/releases/latest");
    expect(application?.softwareVersion).toBe(latestReleaseNotesArtifact()?.version);
    const homeShell = blocks.find((block) => isValidElement(block) && block.type === HomePageShell);
    if (!isValidElement<{ publishedVersion?: string }>(homeShell)) {
      throw new Error("Home page has no rendered shell");
    }
    expect(homeShell.props.publishedVersion).toBe(latestReleaseNotesArtifact()?.version);
  });
});

describe("published version in the hero", () => {
  test("shows the known public version", () => {
    const html = renderToStaticMarkup(
      HeroProofRow({ publishedVersion: "1.2.3", providerCount: 11 }),
    );
    expect(html).toContain(">1.2.3<");
    expect(html).not.toContain(">Release notes<");
  });

  test("links to release notes when no published version is known", () => {
    const html = renderToStaticMarkup(HeroProofRow({ providerCount: 11 }));
    expect(html).toContain(">Release notes<");
    expect(html).not.toContain("undefined");
  });
});

describe("buildPageMetadata social images", () => {
  test("a page that ships its own card declares no site-wide image", () => {
    const own = buildPageMetadata({
      title: "Troubleshooting",
      description: "Fix things.",
      path: "/docs/users/troubleshooting",
      socialImage: "segment",
    });
    expect(own.openGraph).not.toHaveProperty("images");
    expect(own.twitter).not.toHaveProperty("images");
  });

  test("a page with its own card path points both networks at it", () => {
    const own = buildPageMetadata({
      title: "Glossary",
      description: "Terms.",
      path: "/docs/users/glossary",
      socialImageUrl: docsOgImagePath("/docs/users/glossary"),
    });
    expect(own.twitter).toMatchObject({ images: [{ url: "/og/docs/users/glossary" }] });
    // The alt names the page, not the site, so a screen reader is told what the card is.
    expect(own.openGraph).toMatchObject({
      images: [{ url: "/og/docs/users/glossary", alt: expect.stringContaining("Glossary") }],
    });
  });

  test("every other page falls back to the site card", () => {
    const shared = buildPageMetadata({
      title: "Releases",
      description: "Notes.",
      path: "/releases",
    });
    expect(shared.openGraph).toHaveProperty("images");
    expect(shared.twitter).toHaveProperty("images");
  });
});
