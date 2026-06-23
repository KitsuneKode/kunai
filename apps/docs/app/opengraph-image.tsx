import { readFileSync } from "node:fs";
import { join } from "node:path";

import { KunaiSocialCard } from "@/lib/brand/social-card";
import { ImageResponse } from "next/og";

export const alt = "Kunai Docs — terminal-first playback guides";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function mascotDataUrl(): string | undefined {
  try {
    const pngPath = join(process.cwd(), "../../.design/brand/kunai-mascot-og.png");
    const png = readFileSync(pngPath);
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export default function OpenGraphImage() {
  return new ImageResponse(
    <KunaiSocialCard
      eyebrow="KUNAI DOCS"
      headline={["Terminal-first", "playback guides"]}
      subline="Search · resolve streams · mpv handoff · clean recovery"
      command='kunai -S "Your title"'
      footer="docs · kunai"
      mascotSrc={mascotDataUrl()}
    />,
    { ...size },
  );
}
