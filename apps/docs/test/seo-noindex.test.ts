import { describe, expect, test } from "bun:test";

import { metadata as homeMetadata } from "../app/(home)/page";
import { metadata as analyticsMetadata } from "../app/analytics/page";
import { metadata as feedbackMetadata } from "../app/feedback/page";
import sitemap from "../app/sitemap";
import { buildPageMetadata } from "../lib/page-metadata";
import { docsCanonicalUrl, docsSiteUrl } from "../lib/site";

describe("noindex utility pages", () => {
  test("/analytics and /feedback declare noindex but stay followable", () => {
    for (const metadata of [analyticsMetadata, feedbackMetadata]) {
      expect(metadata.robots).toMatchObject({ index: false, follow: true });
    }
  });

  test("/analytics and /feedback are out of the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).not.toContain(`${docsSiteUrl}/analytics`);
    expect(urls).not.toContain(`${docsSiteUrl}/feedback`);
    // Reachable neighbours keep their entries.
    expect(urls).toContain(`${docsSiteUrl}/support`);
    expect(urls).toContain(`${docsSiteUrl}/privacy`);
  });
});

describe("canonical + robots through buildPageMetadata", () => {
  test("every page metadata carries its own canonical URL", () => {
    const metadata = buildPageMetadata({
      title: "Troubleshooting",
      description: "Fix things.",
      path: "/docs/users/troubleshooting",
    });
    expect(metadata.alternates?.canonical).toBe(docsCanonicalUrl("/docs/users/troubleshooting"));
  });

  test("noindex flows to robots while follow stays on", () => {
    const metadata = buildPageMetadata({
      title: "Withdrawn",
      description: "Withdrawn release.",
      path: "/releases/v0.0.0",
      noindex: true,
    });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });
});

describe("home title", () => {
  test("stays within the 60 character SERP budget", () => {
    const absolute =
      typeof homeMetadata.title === "object" && homeMetadata.title !== null
        ? (homeMetadata.title as { absolute?: string }).absolute
        : undefined;
    expect(absolute).toBeDefined();
    expect(absolute!.length).toBeLessThanOrEqual(60);
  });
});
