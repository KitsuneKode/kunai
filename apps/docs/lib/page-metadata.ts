import { docsCanonicalUrl } from "@/lib/site";
import type { Metadata } from "next";

/**
 * Social card image for every page.
 *
 * Next only merges the file-convention `app/opengraph-image.tsx` into a
 * segment that does not declare `openGraph` itself. Every page here declares
 * one, so the generated card was silently dropped from all of them and links
 * shared to Slack, X, and Discord rendered as bare text. Declaring the image
 * explicitly is the deterministic fix; `metadataBase` in the root layout makes
 * this relative URL absolute in the rendered tag.
 */
export const SOCIAL_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Kunai — Kanna, the rose kitsune, above a row of anime, series, and movie marks",
} as const;

/** Same card, dedicated Twitter file-convention route. */
export const TWITTER_IMAGE = {
  ...SOCIAL_IMAGE,
  url: "/twitter-image",
} as const;

/** SERP descriptions get the full 150–160; social cards truncate near 125. */
const SOCIAL_DESCRIPTION_LIMIT = 125;

type PageMetadataInput = {
  readonly title: string;
  /** Long form, for the SERP snippet. */
  readonly description: string;
  /** Short form, for social cards. Falls back to `description` when it fits. */
  readonly socialDescription?: string;
  /** Site-relative path, e.g. `/releases`. */
  readonly path: string;
  readonly type?: "website" | "article";
  /** Title shown in the tab and SERP when it should not take the site suffix. */
  readonly absoluteTitle?: boolean;
  /** Keep the page reachable but out of the index — used by withdrawn releases. */
  readonly noindex?: boolean;
  /**
   * Share routes ship their own `opengraph-image.tsx` / `twitter-image.tsx`.
   * Declaring a site-wide image here would replace those and every unfurl
   * would show the docs card instead of the title that was shared.
   */
  readonly socialImage?: "site" | "segment";
};

function socialDescriptionFor(input: PageMetadataInput): string {
  const explicit = input.socialDescription?.trim();
  if (explicit) return explicit;
  if (input.description.length <= SOCIAL_DESCRIPTION_LIMIT) return input.description;
  // Trim on a word boundary rather than mid-word, and drop trailing punctuation
  // so the ellipsis does not follow a comma.
  const clipped = input.description.slice(0, SOCIAL_DESCRIPTION_LIMIT - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).replace(/[,;:.\s]+$/, "")}…`;
}

/**
 * One metadata shape for every page: canonical, Open Graph, and Twitter with a
 * card image. Pages pass their own copy; nothing about the card is restated.
 */
export function buildPageMetadata(input: PageMetadataInput): Metadata {
  const url = docsCanonicalUrl(input.path);
  const socialDescription = socialDescriptionFor(input);

  const metadata: Metadata = {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      title: input.title,
      description: socialDescription,
      url,
      type: input.type ?? "website",
      siteName: "Kunai Docs",
      ...(input.socialImage === "segment" ? {} : { images: [SOCIAL_IMAGE] }),
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: socialDescription,
      ...(input.socialImage === "segment" ? {} : { images: [TWITTER_IMAGE] }),
    },
  };

  // Follow, but do not index: a withdrawn release keeps its page so an old link
  // still explains itself, while search stops leading people to it.
  if (input.noindex) {
    metadata.robots = { index: false, follow: true };
  }

  return metadata;
}
