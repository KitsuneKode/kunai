import { KunaiSocialCard } from "@/lib/brand/social-card";
import { clipLine, splitHeadline } from "@/lib/brand/split-headline";
import generatedMascot from "@/lib/generated-mascot.json";
import { source } from "@/lib/source";
import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const dynamicParams = false;

const SIZE = { width: 1200, height: 630 } as const;

// Inlined at build time, same as the root card: see `app/opengraph-image.tsx`
// for why this cannot read the PNG from disk here.
const mascotSrc =
  generatedMascot.mascotDataUrl.length > 0 ? generatedMascot.mascotDataUrl : undefined;

/** Characters the card's one-line subline fits before it would wrap. */
const SUBLINE_BUDGET = 96;

/** One card per docs page, generated at build time from the same list the pages use. */
export function generateStaticParams() {
  return source.generateParams();
}

/**
 * The card shown when a docs page is pasted into Slack, Discord or X.
 *
 * It names the page. The site-wide card said "Terminal-first playback guides"
 * under every link, so a share of "Troubleshooting" and a share of "CLI
 * reference" were indistinguishable in a chat. The title and description come
 * from the same frontmatter the page renders, so there is no second copy to
 * keep in step.
 *
 * This is a route handler rather than an `opengraph-image` file because Next
 * does not allow that convention beneath a catch-all segment, which is what the
 * docs tree is. The page's metadata points at this path explicitly
 * (`docsOgImagePath`).
 *
 * A slug that resolves to no page still returns the generic card: unfurlers
 * treat a failed image as no image at all.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly slug?: string[] }> },
) {
  const page = source.getPage((await params).slug);

  return new ImageResponse(
    <KunaiSocialCard
      eyebrow="KUNAI DOCS"
      headline={splitHeadline(page?.data.title ?? "", "Kunai docs")}
      subline={
        page?.data.description
          ? clipLine(page.data.description, SUBLINE_BUDGET)
          : "Search, resolve streams, mpv handoff, clean recovery"
      }
      command='kunai -S "Your title"'
      footer="docs · kunai"
      mascotSrc={mascotSrc}
    />,
    { ...SIZE },
  );
}
