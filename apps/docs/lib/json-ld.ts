import { docsSiteUrl } from "./site";

/**
 * JSON-LD is authored text inside a raw script sink: `JSON.stringify` alone
 * lets a `</script>` inside any string close the tag early. Escape `<` so the
 * payload can never leave the script element.
 */
export function serializeJsonLd<T>(data: T): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// No SearchAction potentialAction: the target would be /api/search, a JSON
// endpoint — schema.org expects an HTML results page, and Google retired the
// sitelinks search box the action fed anyway.
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Kunai Docs",
    url: docsSiteUrl,
    description: "Guides for Kunai playback, recovery, offline use, diagnostics, and reliability.",
  };
}

/**
 * The home page describes an installable application, not just a website.
 *
 * This tells a search engine the platforms, the price, the licence and where to
 * get it, which `WebSite` alone does not. It does not promise a rich result:
 * Google's software-app result also asks for a rating or review, and there are
 * deliberately none here because there are none to claim. Every field is a fact
 * the repo already asserts elsewhere; nothing is invented.
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
    // The same card the site shares, so a crawler that wants a picture of the
    // app is handed the one a person would see.
    image: `${docsSiteUrl}/opengraph-image`,
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "Command Line Media Player",
    operatingSystem: "Linux, macOS, Windows",
    softwareVersion: input.version,
    softwareRequirements: "mpv",
    downloadUrl: "https://github.com/KitsuneKode/kunai/releases/latest",
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
      // Where else the project verifiably lives, so the entity is one thing to
      // a crawler rather than three unconnected pages.
      sameAs: [
        "https://github.com/KitsuneKode/kunai",
        "https://www.npmjs.com/package/@kitsunekode/kunai",
      ],
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
