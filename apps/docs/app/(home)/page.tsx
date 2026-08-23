import HomePageShell from "@/app/(home)/home-page-shell";
import { UsageLine } from "@/components/home/usage-line";
import { codeMetadata } from "@/lib/code-metadata";
import { featuredCommands, summarizeProviders } from "@/lib/home-presenters";
import { websiteJsonLd } from "@/lib/json-ld";
import { buildPageMetadata } from "@/lib/page-metadata";
import type { Metadata } from "next";
import type { ReactNode } from "react";

/** Allow hourly refresh of the quiet usage metrics line without a full rebuild. */
export const revalidate = 3600;

export const metadata: Metadata = buildPageMetadata({
  title: "Kunai — terminal client for third-party streams & mpv",
  absoluteTitle: true,
  description:
    "A terminal client that searches a title, resolves a stream a third-party provider already serves, hands playback to mpv, and recovers without a restart.",
  socialDescription:
    "Search a title, resolve a third-party stream, hand playback to mpv, and recover without restarting.",
  path: "/",
});

export default function HomePage() {
  const jsonLd = websiteJsonLd();
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
