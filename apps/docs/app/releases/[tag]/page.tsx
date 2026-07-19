import { ReleaseDetail } from "@/components/releases/release-detail";
import {
  getReleaseByTag,
  normalizeReleaseTag,
  readReleaseNotesArtifacts,
} from "@/lib/release-notes";
import { docsSiteUrl } from "@/lib/site";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-static";

type ReleaseTagPageProps = {
  readonly params: Promise<{ readonly tag: string }>;
};

export function generateStaticParams() {
  return readReleaseNotesArtifacts().map((release) => ({
    tag: normalizeReleaseTag(release.tag),
  }));
}

export async function generateMetadata({ params }: ReleaseTagPageProps): Promise<Metadata> {
  const { tag } = await params;
  const release = getReleaseByTag(tag);
  if (!release) {
    return { title: "Release not found" };
  }

  const path = `/releases/${normalizeReleaseTag(release.tag)}`;
  return {
    title: release.title,
    description: release.summary.slice(0, 160).replace(/\s+/g, " ").trim(),
    alternates: {
      canonical: `${docsSiteUrl}${path}`,
    },
    openGraph: {
      title: release.title,
      description: release.summary.slice(0, 160).replace(/\s+/g, " ").trim(),
      url: `${docsSiteUrl}${path}`,
      type: "article",
      siteName: "Kunai Docs",
    },
  };
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
