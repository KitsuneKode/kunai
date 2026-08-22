import HomePageShell from "@/app/(home)/home-page-shell";
import { UsageLine } from "@/components/home/usage-line";
import { codeMetadata } from "@/lib/code-metadata";
import { featuredCommands, summarizeProviders } from "@/lib/home-presenters";
import { websiteJsonLd } from "@/lib/json-ld";
import { docsSiteUrl } from "@/lib/site";
import type { Metadata } from "next";
import type { ReactNode } from "react";

/** Allow hourly refresh of the quiet usage metrics line without a full rebuild. */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: {
    absolute: "Kunai Docs",
  },
  description:
    "A terminal-first guide for the Kunai client: resolve third-party streams, hand off to mpv, recover, and use local offline files.",
  alternates: {
    canonical: docsSiteUrl,
  },
  openGraph: {
    title: "Kunai Docs",
    description:
      "A terminal-first guide for the Kunai client: resolve third-party streams, hand off to mpv, recover, and use local offline files.",
    url: docsSiteUrl,
    type: "website",
    siteName: "Kunai Docs",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kunai Docs",
    description:
      "A terminal-first guide for the Kunai client: resolve third-party streams, hand off to mpv, recover, and use local offline files.",
  },
};

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
