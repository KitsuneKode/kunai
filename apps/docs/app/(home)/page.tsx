import HomePageShell from "@/app/(home)/home-page-shell";
import { UsageLine } from "@/components/home/usage-line";
import { codeMetadata } from "@/lib/code-metadata";
import { featuredCommands, summarizeProviders } from "@/lib/home-presenters";
import { softwareApplicationJsonLd, websiteJsonLd } from "@/lib/json-ld";
import { buildPageMetadata } from "@/lib/page-metadata";
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
  "Kunai is a terminal client that searches anime, series, movies, and YouTube, resolves a stream a direct provider already serves, and plays it in mpv.";

export const metadata: Metadata = buildPageMetadata({
  title: "Kunai — watch anime, series and movies in your terminal",
  absoluteTitle: true,
  description: HOME_DESCRIPTION,
  socialDescription:
    "Search anime, series, movies, and YouTube from your terminal — resolved by direct providers, played in mpv.",
  path: "/",
});

export default function HomePage() {
  const jsonLd = [
    websiteJsonLd(),
    softwareApplicationJsonLd({
      version: codeMetadata.cliVersion,
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HomePageShell
        providers={codeMetadata.providers}
        paletteCommands={paletteCommands}
        allCommands={codeMetadata.commands}
        providerSummary={providerSummary}
        cliVersion={codeMetadata.cliVersion}
        runtimeBaseline={codeMetadata.runtimeBaseline}
        usageLine={usageLine}
      />
    </>
  );
}
