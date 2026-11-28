import { ReleaseDetail } from "@/components/releases/release-detail";
import { clipLine } from "@/lib/brand/split-headline";
import { breadcrumbListJsonLd, serializeJsonLd, techArticleJsonLd } from "@/lib/json-ld";
import { buildPageMetadata } from "@/lib/page-metadata";
import { getReleaseByTag, normalizeReleaseTag, releaseNotesArtifacts } from "@/lib/release-notes";
import { docsCanonicalUrl } from "@/lib/site";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-static";

type ReleaseTagPageProps = {
  readonly params: Promise<{ readonly tag: string }>;
};

export function generateStaticParams() {
  return releaseNotesArtifacts.map((release) => ({
    tag: normalizeReleaseTag(release.tag),
  }));
}

function describeRelease(release: NonNullable<ReturnType<typeof getReleaseByTag>>): string {
  const summary = release.summary.replace(/\s+/g, " ").trim();
  if (release.status === "withdrawn") {
    return `Kunai ${release.tag} was withdrawn and should not be installed. Upgrade to the current release, or run kunai rollback if you are already on it.`;
  }
  return summary
    ? clipLine(summary, 158)
    : `Release notes for Kunai ${release.tag}: what changed in this version of the terminal streaming client, and the exact command to install or upgrade to it.`;
}

export async function generateMetadata({ params }: ReleaseTagPageProps): Promise<Metadata> {
  const { tag } = await params;
  const release = getReleaseByTag(tag);
  if (!release) {
    return { title: "Release not found" };
  }

  const withdrawn = release.status === "withdrawn";
  const noindex = release.status !== "published";

  return buildPageMetadata({
    title: withdrawn ? `${release.title} (withdrawn)` : `${release.title} Release Notes`,
    absoluteTitle: true,
    description: describeRelease(release),
    path: `/releases/${normalizeReleaseTag(release.tag)}`,
    type: "article",
    publishedTime: release.publishedAt ?? release.date ?? undefined,
    modifiedTime: release.publishedAt ?? release.date ?? undefined,
    noindex,
  });
}

export default async function ReleaseTagPage({ params }: ReleaseTagPageProps) {
  const { tag } = await params;
  const release = getReleaseByTag(tag);
  if (!release) notFound();

  const path = `/releases/${normalizeReleaseTag(release.tag)}`;
  const url = docsCanonicalUrl(path);
  const dateModified = release.publishedAt ?? release.date;
  const jsonLd = [
    techArticleJsonLd({
      title: release.title,
      description: describeRelease(release),
      url,
      image: docsCanonicalUrl("/opengraph-image"),
      datePublished: dateModified ?? undefined,
      dateModified: dateModified ?? undefined,
    }),
    breadcrumbListJsonLd([
      { name: "Kunai", url: docsCanonicalUrl("/") },
      { name: "Releases", url: docsCanonicalUrl("/releases") },
      { name: release.tag, url },
    ]),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
        <ReleaseDetail release={release} />
      </main>
    </>
  );
}
