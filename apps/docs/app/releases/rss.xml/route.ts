import { buildRssFeedXml, releaseFeedItems } from "@/lib/rss";
import { docsCanonicalUrl } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const xml = buildRssFeedXml(releaseFeedItems(), {
    title: "Kunai Releases",
    description: "Published Kunai CLI releases, changelog highlights, and install commands.",
    siteUrl: docsCanonicalUrl("/releases"),
    selfUrl: docsCanonicalUrl("/releases/rss.xml"),
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
