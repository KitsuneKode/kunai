import { docsSiteUrl } from "./site";

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Kunai Docs",
    url: docsSiteUrl,
    description: "Guides for Kunai playback, recovery, offline use, diagnostics, and reliability.",
    potentialAction: {
      "@type": "SearchAction",
      target: `${docsSiteUrl}/api/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * The home page describes an installable application, not just a website.
 *
 * `WebSite` alone made Kunai ineligible for the software result Google renders
 * for a free app — the one that shows the platforms and the price. Every field
 * here is a fact the repo already asserts elsewhere; nothing is invented, and
 * there is deliberately no `aggregateRating`, because there are no ratings.
 */
export function softwareApplicationJsonLd(input: {
  readonly version: string;
  readonly description: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Kunai",
    url: docsSiteUrl,
    description: input.description,
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "Command Line Media Player",
    operatingSystem: "Linux, macOS, Windows",
    softwareVersion: input.version,
    softwareRequirements: "mpv",
    downloadUrl: "https://www.npmjs.com/package/@kitsunekode/kunai",
    license: "https://github.com/KitsuneKode/kunai/blob/main/LICENSE",
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    author: {
      "@type": "Organization",
      name: "Kunai",
      url: "https://github.com/KitsuneKode/kunai",
    },
  };
}

export function techArticleJsonLd(input: {
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly dateModified?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: input.title,
    description: input.description,
    url: input.url,
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    publisher: {
      "@type": "Organization",
      name: "Kunai",
    },
  };
}

export function breadcrumbListJsonLd(
  items: readonly { readonly name: string; readonly url: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function faqPageJsonLd(
  entries: readonly { readonly question: string; readonly answer: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: entry.answer,
      },
    })),
  };
}
