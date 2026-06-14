import HomePageClient from "@/app/(home)/home-page-client";
import { codeMetadata } from "@/lib/code-metadata";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kunai Docs",
  description:
    "A terminal-first Kunai guide for playable streams, mpv playback, recovery, offline use, and diagnostics.",
};

export default function HomePage() {
  return (
    <HomePageClient
      providers={codeMetadata.providers}
      commands={codeMetadata.commands}
      flags={codeMetadata.cliOptions}
      commandCount={codeMetadata.commandCount}
      providerCount={codeMetadata.providerIds.length}
    />
  );
}
