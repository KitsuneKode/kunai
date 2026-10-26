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
  // pages get their publishedAt and doc pages their known git-modified date.
  // Home does not borrow the date of an unrelated guide. Pages whose
  // content is fixed (privacy, support) omit lastmod rather than claim a
  // date that isn't theirs. /analytics and /feedback carry noindex and stay
  // out of the sitemap entirely. No priority/changefreq: crawlers ignore both.
  const releaseDates = releases
    .map((release) => release.publishedAt ?? release.date)
    .filter((date): date is string => Boolean(date))
    .map((date) => new Date(date).getTime())
    .filter((time) => Number.isFinite(time));
  const latestRelease = releaseDates.length ? Math.max(...releaseDates) : null;

  return [
    {
      url: docsSiteUrl,
    },
    {
      url: `${docsSiteUrl}/releases`,
      lastModified: latestRelease ? new Date(latestRelease) : undefined,
    },
    {
      url: `${docsSiteUrl}/support`,
    },
    {
      url: `${docsSiteUrl}/privacy`,
    },
    ...releases.map((release) => ({
      url: `${docsSiteUrl}${releasePath(release.tag)}`,
      lastModified: release.publishedAt ?? release.date ?? undefined,
    })),
    ...pages.map((page) => ({
      url: `${docsSiteUrl}${page.url}`,
      lastModified: page.data.lastModified,
    })),
  ];
}
