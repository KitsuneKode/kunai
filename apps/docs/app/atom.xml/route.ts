import { buildAtomFeedXml, siteFeedItems } from "@/lib/rss";
import { docsCanonicalUrl, docsSiteUrl } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const xml = buildAtomFeedXml(siteFeedItems(), {
    title: "Kunai — Releases & Documentation",
    description:
      "Release notes, changelog highlights, and documentation updates for Kunai, the terminal media client for mpv.",
    siteUrl: docsSiteUrl,
    selfUrl: docsCanonicalUrl("/atom.xml"),
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
