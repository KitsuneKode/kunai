import { ReleaseDetail } from "@/components/releases/release-detail";
import { buildPageMetadata } from "@/lib/page-metadata";
import { getReleaseByTag, normalizeReleaseTag, releaseNotesArtifacts } from "@/lib/release-notes";
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

export async function generateMetadata({ params }: ReleaseTagPageProps): Promise<Metadata> {
  const { tag } = await params;
  const release = getReleaseByTag(tag);
  if (!release) {
    return { title: "Release not found" };
  }

  // A staged artifact can carry an empty summary — the removed v0.2.6 artifact
  // did — which rendered the page with a blank meta description. Fall back to a
  // real sentence rather than shipping an empty tag.
  const summary = release.summary.replace(/\s+/g, " ").trim();
  const withdrawn = release.status === "withdrawn";
  const description = withdrawn
    ? `Kunai ${release.tag} was withdrawn and should not be installed. Upgrade to the current release, or run kunai rollback if you are already on it.`
    : summary
      ? summary.slice(0, 160)
      : `Release notes for Kunai ${release.tag}: what changed in this version of the terminal streaming client, and the exact command to install or upgrade to it.`;

  return buildPageMetadata({
    title: withdrawn ? `${release.title} (withdrawn)` : release.title,
    description,
    path: `/releases/${normalizeReleaseTag(release.tag)}`,
    type: "article",
    // Reachable for anyone following an old link, but not something to keep
    // surfacing in search results.
    noindex: withdrawn,
  });
}

export default async function ReleaseTagPage({ params }: ReleaseTagPageProps) {
  const { tag } = await params;
  const release = getReleaseByTag(tag);
  if (!release) notFound();

  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
      <ReleaseDetail release={release} />
    </main>
  );
}
