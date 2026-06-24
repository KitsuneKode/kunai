import HomePageShell from "@/app/(home)/home-page-shell";
import { codeMetadata } from "@/lib/code-metadata";
import { featuredCommands, summarizeProviders } from "@/lib/home-presenters";
import { websiteJsonLd } from "@/lib/json-ld";
import { docsSiteUrl } from "@/lib/site";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Kunai Docs",
  description:
    "A terminal-first Kunai guide for playable streams, mpv playback, recovery, offline use, and diagnostics.",
  alternates: {
    canonical: docsSiteUrl,
  },
  openGraph: {
    title: "Kunai Docs",
    description:
      "A terminal-first Kunai guide for playable streams, mpv playback, recovery, offline use, and diagnostics.",
    url: docsSiteUrl,
    type: "website",
    siteName: "Kunai Docs",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kunai Docs",
    description:
      "A terminal-first Kunai guide for playable streams, mpv playback, recovery, offline use, and diagnostics.",
  },
};

export default function HomePage() {
  const jsonLd = websiteJsonLd();
  const paletteCommands = featuredCommands(codeMetadata.commands);
  const providerSummary = summarizeProviders(codeMetadata.providers);

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
      />
    </>
  );
}
