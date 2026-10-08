import { docsSiteUrl } from "@/lib/site";
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // JSON API responses (e.g. /api/search) are not crawlable content.
      disallow: "/api/",
    },
    sitemap: `${docsSiteUrl}/sitemap.xml`,
  };
}
