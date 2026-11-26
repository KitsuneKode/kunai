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
  alt: "Kunai: Kanna, the rose kitsune, above a row of anime, series, and movie marks",
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
  /**
   * A card for this page alone, as a site-relative path. For routes that cannot
   * use the `opengraph-image` file convention: it is not allowed beneath a
   * catch-all segment, which is what the docs tree is. Wins over `socialImage`.
   */
  readonly socialImageUrl?: string;
  /** Optional site-relative Markdown URL exposed via `<link rel="alternate" type="text/markdown">`. */
  readonly markdownPath?: string;
  readonly publishedTime?: string;
  readonly modifiedTime?: string;
};

/** The docs card route for a docs page URL, e.g. `/docs/users/glossary`. */
export function docsOgImagePath(pageUrl: string): string {
  return `/og${pageUrl}`;
}

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
  const ownImage = input.socialImageUrl
    ? { ...SOCIAL_IMAGE, url: input.socialImageUrl, alt: `Kunai docs: ${input.title}` }
    : null;

  const alternateTypes: NonNullable<NonNullable<Metadata["alternates"]>["types"]> = {
    "application/rss+xml": [
      { url: docsCanonicalUrl("/rss.xml"), title: "Kunai — Releases & Documentation (RSS)" },
    ],
    "application/atom+xml": [
      { url: docsCanonicalUrl("/atom.xml"), title: "Kunai — Releases & Documentation (Atom)" },
    ],
  };
  if (input.markdownPath) {
    alternateTypes["text/markdown"] = docsCanonicalUrl(input.markdownPath);
  }
  const alternates: NonNullable<Metadata["alternates"]> = {
    canonical: url,
    types: alternateTypes,
  };

  const ogImages = ownImage
    ? [ownImage]
    : input.socialImage === "segment"
      ? undefined
      : [SOCIAL_IMAGE];
  const openGraph: NonNullable<Metadata["openGraph"]> =
    input.type === "article"
      ? {
          title: input.title,
          description: socialDescription,
          url,
          type: "article",
          locale: "en_US",
          siteName: "Kunai Docs",
          ...(input.publishedTime ? { publishedTime: input.publishedTime } : undefined),
          ...(input.modifiedTime ? { modifiedTime: input.modifiedTime } : undefined),
          ...(ogImages ? { images: ogImages } : undefined),
        }
      : {
          title: input.title,
          description: socialDescription,
          url,
          type: "website",
          locale: "en_US",
          siteName: "Kunai Docs",
          ...(ogImages ? { images: ogImages } : undefined),
        };

  const twitterImages = ownImage
    ? [ownImage]
    : input.socialImage === "segment"
      ? undefined
      : [TWITTER_IMAGE];
  const twitter: NonNullable<Metadata["twitter"]> = {
    card: "summary_large_image",
    site: "@KitsuneKode",
    creator: "@KitsuneKode",
    title: input.title,
    description: socialDescription,
    ...(twitterImages ? { images: twitterImages } : undefined),
  };

  const metadata: Metadata = {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    alternates,
    openGraph,
    twitter,
  };

  // Follow, but do not index: a withdrawn release keeps its page so an old link
  // still explains itself, while search stops leading people to it.
  if (input.noindex) {
    metadata.robots = { index: false, follow: true };
  }

  return metadata;
}
