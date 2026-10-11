import {
  indexableReleaseNotesArtifacts,
  latestReleaseNotesArtifact,
  releasePath,
} from "@/lib/release-notes";
import { docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

type SitemapEntry = MetadataRoute.Sitemap[number];

/** One entry. `lastModified` is set only when there is a truthful date for the page. */
function entry(
  url: string,
  changeFrequency: SitemapEntry["changeFrequency"],
  priority: number,
  lastModified?: string,
): SitemapEntry {
  const built: SitemapEntry = { url, changeFrequency, priority };
  if (lastModified) built.lastModified = lastModified;
  return built;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages();
  // Withdrawn releases keep their page but leave the sitemap: the point of a
  // withdrawal is to stop people arriving at that version.
  const releases = indexableReleaseNotesArtifacts();
  // The two pages that change when a release ships. Search engines use
  // `lastmod` to decide what to recrawl, and only when it is truthful, so it is
  // the latest release's date rather than the build time.
  const latestRelease = latestReleaseNotesArtifact();
  const lastReleased = latestRelease?.publishedAt ?? latestRelease?.date ?? undefined;

  return [
    entry(docsSiteUrl, "weekly", 1, lastReleased),
    entry(`${docsSiteUrl}/releases`, "weekly", 0.8, lastReleased),
    {
      url: `${docsSiteUrl}/feedback`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${docsSiteUrl}/support`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${docsSiteUrl}/analytics`,
      changeFrequency: "daily",
      priority: 0.55,
    },
    {
      url: `${docsSiteUrl}/privacy`,
      changeFrequency: "monthly",
      priority: 0.5,
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
