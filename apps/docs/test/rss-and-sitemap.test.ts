import { describe, expect, test } from "bun:test";

import { GET as getAtom } from "../app/atom.xml/route";
import { GET as getReleasesRss } from "../app/releases/rss.xml/route";
import robots from "../app/robots";
import { GET as getRss } from "../app/rss.xml/route";
import sitemap from "../app/sitemap";
import { buildPageMetadata } from "../lib/page-metadata";
import { buildAtomFeedXml, buildRssFeedXml, escapeXml, releaseFeedItems } from "../lib/rss";
import { docsCanonicalUrl, docsSiteUrl } from "../lib/site";

describe("RSS and Atom feeds", () => {
  test("/rss.xml returns valid RSS 2.0 XML with self link and published items", async () => {
    const res = getRss();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    const xml = await res.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(xml).toContain(`href="${docsCanonicalUrl("/rss.xml")}" rel="self"`);
    expect(xml).toContain("<item>");
  });

  test("/atom.xml returns valid Atom 1.0 XML with self and alternate links", async () => {
    const res = getAtom();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");
    const xml = await res.text();
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain(`href="${docsCanonicalUrl("/atom.xml")}" rel="self"`);
    expect(xml).toContain("<entry>");
  });

  test("/releases/rss.xml serves published releases only", async () => {
    const res = getReleasesRss();
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain(`href="${docsCanonicalUrl("/releases/rss.xml")}" rel="self"`);
    expect(xml).toContain("<category>Release</category>");
    expect(xml).not.toContain("<category>Guide</category>");
  });

  test("XML builders escape special characters and omit withdrawn/staged releases", () => {
    expect(escapeXml(`a & b <c> "d" 'e'`)).toBe("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;");

    const rss = buildRssFeedXml(
      [
        {
          id: "https://kunai.kitsunekode.in/releases/v0.4.0",
          title: "Kunai <0.4> & Friends",
          url: "https://kunai.kitsunekode.in/releases/v0.4.0",
          summary: "Fast & safe <mpv>",
          publishedAt: new Date("2026-11-20T00:00:00Z"),
          category: "Release",
        },
      ],
      {
        title: "Kunai",
        description: "Test & feed",
        siteUrl: docsSiteUrl,
        selfUrl: docsCanonicalUrl("/rss.xml"),
      },
    );
    expect(rss).toContain("Kunai &lt;0.4&gt; &amp; Friends");
    // RSS <description> is interpreted as HTML by feed readers, so plain text is HTML-escaped then XML-escaped.
    expect(rss).toContain("<description>Fast &amp;amp; safe &amp;lt;mpv&amp;gt;</description>");

    const atom = buildAtomFeedXml(
      [
        {
          id: "https://kunai.kitsunekode.in/releases/v0.4.0",
          title: "Kunai <0.4> & Friends",
          url: "https://kunai.kitsunekode.in/releases/v0.4.0",
          summary: "Fast & safe <mpv>",
          publishedAt: new Date("2026-11-20T00:00:00Z"),
          category: "Release",
        },
      ],
      {
        title: "Kunai",
        description: "Empty",
        siteUrl: docsSiteUrl,
        selfUrl: docsCanonicalUrl("/atom.xml"),
      },
    );
    expect(atom).toContain("<feed xmlns=");
    expect(atom).toContain("<summary>Fast &amp; safe &lt;mpv&gt;</summary>");

    const filtered = releaseFeedItems([
      {
        schemaVersion: 2,
        status: "withdrawn",
        publishedAt: "2026-11-20T00:00:00Z",
        packageName: "@kitsunekode/kunai",
        version: "0.0.1",
        tag: "v0.0.1",
        title: "Withdrawn",
        date: "2026-11-20",
        summary: "Withdrawn",
        sections: [],
        install: { npm: "", bunx: "", binaryLatest: "" },
      },
    ]);
    expect(filtered).toEqual([]);
  });
});

describe("sitemap, robots, and metadata alternates", () => {
  test("sitemap entries have unique sorted canonicals and valid Date lastModified values", () => {
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(15);
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(entries.length);
    for (const entry of entries) {
      if (entry.lastModified !== undefined) {
        expect(entry.lastModified).toBeInstanceOf(Date);
        expect(Number.isFinite((entry.lastModified as Date).getTime())).toBe(true);
      }
    }
  });

  test("robots points at sitemap.xml in production and blocks crawling on preview deployments", () => {
    const previous = process.env.VERCEL_ENV;
    try {
      process.env.VERCEL_ENV = "production";
      const prod = robots();
      expect(prod.sitemap).toBe(`${docsSiteUrl}/sitemap.xml`);
      expect(prod.host).toBe(docsSiteUrl);

      process.env.VERCEL_ENV = "preview";
      const preview = robots();
      expect(preview.sitemap).toBeUndefined();
      expect(preview.host).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previous;
    }
  });

  test("buildPageMetadata advertises RSS, Atom, and optional Markdown alternates together", () => {
    const meta = buildPageMetadata({
      title: "Getting started",
      description: "Install Kunai.",
      path: "/docs/users/getting-started",
      markdownPath: "/docs/users/getting-started.mdx",
    });
    expect(meta.alternates?.canonical).toBe(docsCanonicalUrl("/docs/users/getting-started"));
    expect(meta.alternates?.types?.["text/markdown"]).toBe(
      docsCanonicalUrl("/docs/users/getting-started.mdx"),
    );
    expect(meta.alternates?.types?.["application/rss+xml"]).toBeDefined();
    expect(meta.alternates?.types?.["application/atom+xml"]).toBeDefined();
  });
});
