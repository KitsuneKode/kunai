import HomePageShell from "@/app/(home)/home-page-shell";
import { UsageLine } from "@/components/home/usage-line";
import { codeMetadata } from "@/lib/code-metadata";
import { featuredCommands, summarizeProviders } from "@/lib/home-presenters";
import { serializeJsonLd, softwareApplicationJsonLd, websiteJsonLd } from "@/lib/json-ld";
import { buildPageMetadata } from "@/lib/page-metadata";
import { latestReleaseNotesArtifact } from "@/lib/release-notes";
import type { Metadata } from "next";
import type { ReactNode } from "react";

/** Allow hourly refresh of the quiet usage metrics line without a full rebuild. */
export const revalidate = 3600;

/**
 * The one string most people read before deciding whether to keep reading.
 *
 * It used to say "terminal client for third-party streams", which describes the
 * architecture to someone who already knows what Kunai is. What it plays —
 * anime, series, movies, YouTube — is both the thing a visitor wants to know
 * and the thing anyone searching for this would actually type.
 */
const HOME_DESCRIPTION =
  "Watch anime, movies, TV series and YouTube from your terminal with mpv. Search, switch sources, resume playback and queue offline downloads.";

export const metadata: Metadata = buildPageMetadata({
  title: "Kunai | Anime, movies & YouTube in your terminal",
  absoluteTitle: true,
  description: HOME_DESCRIPTION,
  socialDescription:
    "Anime, movies, TV series and YouTube in one terminal client, with mpv playback, source switching and resume.",
  path: "/",
});

export default function HomePage() {
  const publishedRelease = latestReleaseNotesArtifact();
  const jsonLd = [
    websiteJsonLd(),
    softwareApplicationJsonLd({
      version: publishedRelease?.version,
      description: HOME_DESCRIPTION,
    }),
  ];
  const paletteCommands = featuredCommands(codeMetadata.commands);
  const providerSummary = summarizeProviders(codeMetadata.providers);
  const usageLine: ReactNode = <UsageLine />;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <HomePageShell
        providers={codeMetadata.providers}
        paletteCommands={paletteCommands}
        allCommands={codeMetadata.commands}
        providerSummary={providerSummary}
        cliVersion={codeMetadata.cliVersion}
        publishedVersion={publishedRelease?.version}
        runtimeBaseline={codeMetadata.runtimeBaseline}
        usageLine={usageLine}
      />
    </>
  );
}
