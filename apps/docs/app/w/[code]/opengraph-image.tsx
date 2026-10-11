import { KunaiSocialCard } from "@/lib/brand/social-card";
import { splitHeadline } from "@/lib/brand/split-headline";
import generatedMascot from "@/lib/generated-mascot.json";
import { catalogFor, positionFor, titleFor } from "@/lib/share-presentation";
import { decodePlaybackTargetWebCode } from "@kunai/types";
import { ImageResponse } from "next/og";

export const alt = "A title shared with Kunai, watched over by Kanna";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Inlined at build time, same as the root card — see `app/opengraph-image.tsx`
// for why this cannot read the PNG from disk here.
const mascotSrc =
  generatedMascot.mascotDataUrl.length > 0 ? generatedMascot.mascotDataUrl : undefined;

/**
 * The card a person actually sees when a share link is pasted into WhatsApp,
 * Twitter, or Discord.
 *
 * The share code already carries the title, so the unfurl names the work rather
 * than describing the docs site. Everything comes out of the code itself: this
 * route never fetches poster art, which would put TMDB/AniList in the unfurl
 * latency path and tell them which titles get shared.
 *
 * A code that does not decode falls back to the generic card. Unfurlers treat a
 * failed image as no image at all, so throwing here would cost the preview.
 */
export default async function ShareOpenGraphImage({
  params,
}: {
  readonly params: Promise<{ readonly code: string }>;
}) {
  const { code } = await params;
  const shared = decodePlaybackTargetWebCode(code);

  if (!shared) {
    return new ImageResponse(
      <KunaiSocialCard
        eyebrow="KUNAI"
        headline={["Shared link", "not readable"]}
        subline="Kunai never guesses a title from a damaged code."
        command="kunai --open <link>"
        footer="share · kunai"
        mascotSrc={mascotSrc}
      />,
      { ...size },
    );
  }

  const title = titleFor(shared.ref);

  return new ImageResponse(
    <KunaiSocialCard
      eyebrow="SHARED WITH KUNAI"
      headline={splitHeadline(title, "Shared with Kunai")}
      subline={`${positionFor(shared.ref)} · ${catalogFor(shared.ref)}`}
      command="kunai --open <link>"
      footer="share · kunai"
      kind={shared.ref.kind}
      mascotSrc={mascotSrc}
    />,
    { ...size },
  );
}
