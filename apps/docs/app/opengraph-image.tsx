import { KunaiSocialCard } from "@/lib/brand/social-card";
import generatedMascot from "@/lib/generated-mascot.json";
import { ImageResponse } from "next/og";

export const alt = "Kunai — the pink kitsune watcher, with anime, series, and movie companions";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Inlined at build time by `apps/docs/scripts/sync-repo-content.ts`. Reading the PNG here
// put a filesystem probe in the runtime bundle, which the Turbopack tracer
// could not follow — see that script's header. An empty value means the
// generator could not read the source PNG; the card renders without a mascot
// rather than failing the route.
const mascotSrc =
  generatedMascot.mascotDataUrl.length > 0 ? generatedMascot.mascotDataUrl : undefined;

export default function OpenGraphImage() {
  return new ImageResponse(
    <KunaiSocialCard
      eyebrow="KUNAI DOCS"
      headline={["Terminal-first", "playback guides"]}
      subline="Search · resolve streams · mpv handoff · clean recovery"
      command='kunai -S "Your title"'
      footer="docs · kunai"
      mascotSrc={mascotSrc}
    />,
    { ...size },
  );
}
