import type { Metadata } from "next";

import HomePageClient from "./home-page-client";

export const metadata: Metadata = {
  title: "Kunai Docs",
  description:
    "A terminal-first Kunai guide for playable streams, mpv playback, recovery, offline use, and diagnostics.",
};

export default function HomePage() {
  return <HomePageClient />;
}
