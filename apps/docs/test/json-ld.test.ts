import { describe, expect, test } from "bun:test";

import { softwareApplicationJsonLd } from "../lib/json-ld";
import { buildPageMetadata, docsOgImagePath } from "../lib/page-metadata";

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
