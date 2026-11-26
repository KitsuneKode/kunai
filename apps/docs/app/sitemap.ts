import { indexableReleaseNotesArtifacts, releasePath } from "@/lib/release-notes";
import { docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

function toValidDate(raw: string | Date | null | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [...source.getPages()].sort((a, b) => a.url.localeCompare(b.url));
  // Withdrawn releases keep their page but leave the sitemap: the point of a
  // withdrawal is to stop people arriving at that version.
  const releases = [...indexableReleaseNotesArtifacts()].sort((a, b) =>
    releasePath(a.tag).localeCompare(releasePath(b.tag)),
  );

  // lastModified only carries dates with a real source of truth: release
  // pages get their publishedAt and doc pages their known git-modified date.
  // Home does not borrow the date of an unrelated guide. Pages whose
  // content is fixed (privacy, support) omit lastmod rather than claim a
  // date that isn't theirs. /analytics and /feedback carry noindex and stay
  // out of the sitemap entirely. No priority/changefreq: crawlers ignore both.
  const releaseDates = releases
    .map((release) => toValidDate(release.publishedAt ?? release.date))
    .filter((date): date is Date => date !== undefined)
    .map((date) => date.getTime());
  const latestRelease = releaseDates.length ? new Date(Math.max(...releaseDates)) : undefined;

  const makeEntry = (url: string, lastModified?: Date): MetadataRoute.Sitemap[number] => {
    const entry: MetadataRoute.Sitemap[number] = { url };
    if (lastModified) entry.lastModified = lastModified;
    return entry;
  };

  const rawEntries: MetadataRoute.Sitemap = [
    makeEntry(docsSiteUrl),
    makeEntry(`${docsSiteUrl}/releases`, latestRelease),
    makeEntry(`${docsSiteUrl}/support`),
    makeEntry(`${docsSiteUrl}/privacy`),
    ...releases.map((release) =>
      makeEntry(
        `${docsSiteUrl}${releasePath(release.tag)}`,
        toValidDate(release.publishedAt ?? release.date),
      ),
    ),
    ...pages.map((page) =>
      makeEntry(`${docsSiteUrl}${page.url}`, toValidDate(page.data.lastModified)),
    ),
  ];

  const seen = new Set<string>();
  return rawEntries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}
