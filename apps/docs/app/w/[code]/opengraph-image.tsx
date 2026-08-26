import { KunaiSocialCard } from "@/lib/brand/social-card";
import generatedMascot from "@/lib/generated-mascot.json";
import { catalogFor, positionFor, titleFor } from "@/lib/share-presentation";
import { decodePlaybackTargetWebCode } from "@kunai/types";
import { ImageResponse } from "next/og";

export const alt = "A title shared with Kunai";
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
      headline={splitHeadline(title)}
      subline={`${positionFor(shared.ref)} · ${catalogFor(shared.ref)}`}
      command="kunai --open <link>"
      footer="share · kunai"
      mascotSrc={mascotSrc}
    />,
    { ...size },
  );
}

/** Characters one headline line fits at the card's type size. */
const LINE_BUDGET = 22;

/**
 * Break a title across at most two lines near its middle.
 *
 * The card's headline slot is two lines tall. Satori does not wrap for us here
 * because each line is its own element, so a long title has to be split before
 * it is handed over or it overflows the card.
 */
export function splitHeadline(title: string): string[] {
  // Collapse every whitespace run, not just the ends. A title carrying a newline
  // or tab reaches satori as literal control characters inside one text node,
  // which lays out unpredictably; and a title that is only whitespace would
  // otherwise render an empty headline on an otherwise complete card.
  const trimmed = title.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return ["Shared with Kunai"];
  if (trimmed.length <= LINE_BUDGET) return [trimmed];

  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    // One unbroken token cannot wrap. Cutting it silently would drop the tail
    // without the reader ever knowing the title continued, so the ellipsis is
    // part of the contract, not decoration.
    if (trimmed.length <= LINE_BUDGET * 2) {
      return [trimmed.slice(0, LINE_BUDGET), trimmed.slice(LINE_BUDGET)];
    }
    return [trimmed.slice(0, LINE_BUDGET), `${trimmed.slice(LINE_BUDGET, LINE_BUDGET * 2 - 1)}…`];
  }

  // Balance the two lines rather than filling the first: a title split as
  // "Attack on" / "Titan" reads better than "Attack on Titan: The Final" / "Season".
  let best = 1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let cut = 1; cut < words.length; cut++) {
    const head = words.slice(0, cut).join(" ").length;
    const tail = words.slice(cut).join(" ").length;
    const delta = Math.abs(head - tail);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = cut;
    }
  }
  const head = words.slice(0, best).join(" ");
  const tail = words.slice(best).join(" ");
  return [truncate(head), truncate(tail)];
}

/** Cut an over-long line, marking it so a dropped tail is never silent. */
function truncate(line: string): string {
  return line.length <= LINE_BUDGET ? line : `${line.slice(0, LINE_BUDGET - 1)}…`;
}
