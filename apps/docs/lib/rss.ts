import {
  displaySectionsForRelease,
  publishedReleaseNotesArtifacts,
  releaseOneLineSummary,
  releasePath,
  type ReleaseNotesArtifact,
} from "@/lib/release-notes";
import { docsCanonicalUrl, docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";

export interface FeedItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly summary: string;
  readonly publishedAt: Date;
  readonly category: "Release" | "Guide";
}

export interface FeedChannelOptions {
  readonly title: string;
  readonly description: string;
  readonly siteUrl: string;
  readonly selfUrl: string;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseValidDate(raw: string | Date | null | undefined): Date | null {
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function releaseFeedSummary(release: ReleaseNotesArtifact): string {
  const headline = releaseOneLineSummary(release);
  const sections = displaySectionsForRelease(release);
  const highlights = sections.flatMap((section) => section.items.slice(0, 3)).slice(0, 6);
  if (highlights.length === 0) return headline;
  return `${headline}\n\nHighlights:\n${highlights.map((item) => `- ${item}`).join("\n")}`;
}

export function releaseFeedItems(
  releases: readonly ReleaseNotesArtifact[] = publishedReleaseNotesArtifacts(),
): readonly FeedItem[] {
  const items: FeedItem[] = [];
  for (const release of releases) {
    if (release.status !== "published") continue;
    const publishedAt = parseValidDate(release.publishedAt ?? release.date);
    if (!publishedAt) continue;
    const url = docsCanonicalUrl(releasePath(release.tag));
    items.push({
      id: url,
      title: `${release.title} (${release.tag})`,
      url,
      summary: releaseFeedSummary(release),
      publishedAt,
      category: "Release",
    });
  }
  return items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

export function siteFeedItems(): readonly FeedItem[] {
  const releases = releaseFeedItems();
  const guideItems: FeedItem[] = [];
  for (const page of source.getPages()) {
    const updated = parseValidDate(page.data.lastModified);
    if (!updated) continue;
    const url = docsCanonicalUrl(page.url);
    guideItems.push({
      id: url,
      title: page.data.title,
      url,
      summary: page.data.description ?? page.data.title,
      publishedAt: updated,
      category: "Guide",
    });
  }
  const latestGuides = guideItems
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || a.url.localeCompare(b.url))
    .slice(0, 12);

  return [...releases, ...latestGuides].sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || a.url.localeCompare(b.url),
  );
}

export function buildRssFeedXml(items: readonly FeedItem[], channel: FeedChannelOptions): string {
  const lastBuildDate = items[0]?.publishedAt ?? new Date(0);
  const itemBlocks = items.map(
    (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.url)}</link>
      <guid isPermaLink="true">${escapeXml(item.id)}</guid>
      <pubDate>${item.publishedAt.toUTCString()}</pubDate>
      <category>${escapeXml(item.category)}</category>
      <description>${escapeXml(escapeXml(item.summary))}</description>
    </item>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.siteUrl)}</link>
    <description>${escapeXml(channel.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate.toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(channel.selfUrl)}" rel="self" type="application/rss+xml" />
${itemBlocks.join("\n")}
  </channel>
</rss>
`;
}

export function buildAtomFeedXml(items: readonly FeedItem[], channel: FeedChannelOptions): string {
  const updated = (items[0]?.publishedAt ?? new Date(0)).toISOString();
  const entryBlocks = items.map(
    (item) => `  <entry>
    <id>${escapeXml(item.id)}</id>
    <title>${escapeXml(item.title)}</title>
    <link href="${escapeXml(item.url)}" rel="alternate" type="text/html" />
    <updated>${item.publishedAt.toISOString()}</updated>
    <category term="${escapeXml(item.category)}" />
    <summary>${escapeXml(item.summary)}</summary>
  </entry>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(channel.selfUrl)}</id>
  <title>${escapeXml(channel.title)}</title>
  <subtitle>${escapeXml(channel.description)}</subtitle>
  <link href="${escapeXml(channel.selfUrl)}" rel="self" type="application/atom+xml" />
  <link href="${escapeXml(channel.siteUrl)}" rel="alternate" type="text/html" />
  <updated>${updated}</updated>
  <author>
    <name>KitsuneKode</name>
    <uri>${escapeXml(docsSiteUrl)}</uri>
  </author>
${entryBlocks.join("\n")}
</feed>
`;
}
