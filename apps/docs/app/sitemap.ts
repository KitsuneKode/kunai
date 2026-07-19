import { readReleaseNotesArtifacts, releasePath } from "@/lib/release-notes";
import { docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages();
  const releases = readReleaseNotesArtifacts();

  return [
    {
      url: docsSiteUrl,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${docsSiteUrl}/releases`,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${docsSiteUrl}/feedback`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${docsSiteUrl}/telemetry`,
      changeFrequency: "daily",
      priority: 0.55,
    },
    ...releases.map((release) => ({
      url: `${docsSiteUrl}${releasePath(release.tag)}`,
      changeFrequency: "monthly" as const,
      priority: 0.65,
    })),
    ...pages.map((page) => ({
      url: `${docsSiteUrl}${page.url}`,
      lastModified: page.data.lastModified,
      changeFrequency: "weekly" as const,
      priority: page.url === "/docs" ? 0.9 : 0.7,
    })),
  ];
}
