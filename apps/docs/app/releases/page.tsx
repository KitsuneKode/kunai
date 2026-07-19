import { ReleaseInstallPanel } from "@/components/releases/release-install-panel";
import { ReleaseTimeline } from "@/components/releases/release-timeline";
import { latestReleaseNotesArtifact, readReleaseNotesArtifacts } from "@/lib/release-notes";
import { docsSiteUrl } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Release Notes",
  description: "Kunai changelog generated from the same tracked release artifacts used for GitHub.",
  alternates: {
    canonical: `${docsSiteUrl}/releases`,
  },
  openGraph: {
    title: "Kunai Release Notes",
    description:
      "Kunai changelog generated from the same tracked release artifacts used for GitHub.",
    url: `${docsSiteUrl}/releases`,
    type: "website",
    siteName: "Kunai Docs",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kunai Release Notes",
    description:
      "Kunai changelog generated from the same tracked release artifacts used for GitHub.",
  },
};

export default function ReleaseNotesPage() {
  const releases = readReleaseNotesArtifacts();
  const latest = latestReleaseNotesArtifact();

  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
      <header className="border-fd-border flex flex-col gap-4 border-b pb-8">
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">Kunai releases</h1>
        <p className="text-fd-muted-foreground max-w-3xl text-base leading-7">
          Changelog from the tracked <code className="font-mono text-sm">.release</code> artifacts —
          the same notes used for GitHub release bodies. Need help or found a regression?{" "}
          <Link href="/feedback" className="text-fd-primary underline-offset-4 hover:underline">
            Open feedback
          </Link>
          .
        </p>
      </header>

      {latest ? <ReleaseInstallPanel release={latest} showCanonical /> : null}

      <ReleaseTimeline releases={releases} />
    </main>
  );
}
