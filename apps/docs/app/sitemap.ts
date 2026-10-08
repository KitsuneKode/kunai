import { indexableReleaseNotesArtifacts, releasePath } from "@/lib/release-notes";
import { docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages();
  // Withdrawn releases keep their page but leave the sitemap: the point of a
  // withdrawal is to stop people arriving at that version.
  const releases = indexableReleaseNotesArtifacts();

  // lastModified only carries dates with a real source of truth: release
  // pages get their publishedAt, hand-listed statics get the newest known
  // content date (a docs-page edit or a release) rather than a build stamp.
  const releaseDates = releases
    .map((release) => release.publishedAt ?? release.date)
    .filter((date): date is string => Boolean(date))
    .map((date) => new Date(date).getTime())
    .filter((time) => Number.isFinite(time));
  const pageDates = pages
    .map((page) => page.data.lastModified)
    .filter((date): date is Date => date instanceof Date)
    .map((date) => date.getTime());
  const latestRelease = releaseDates.length ? Math.max(...releaseDates) : null;
  const latestContent = Math.max(...releaseDates, ...pageDates);
  const contentLastModified = Number.isFinite(latestContent) ? new Date(latestContent) : undefined;

  return [
    {
      url: docsSiteUrl,
      lastModified: contentLastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${docsSiteUrl}/releases`,
      lastModified: latestRelease ? new Date(latestRelease) : undefined,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${docsSiteUrl}/feedback`,
      lastModified: contentLastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${docsSiteUrl}/analytics`,
      lastModified: contentLastModified,
      changeFrequency: "daily",
      priority: 0.55,
    },
    {
      url: `${docsSiteUrl}/privacy`,
      lastModified: contentLastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    ...releases.map((release) => ({
      url: `${docsSiteUrl}${releasePath(release.tag)}`,
      lastModified: release.publishedAt ?? release.date ?? undefined,
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
