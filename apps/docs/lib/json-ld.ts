import { docsCanonicalUrl, docsSiteUrl } from "./site";

const ORG_ID = `${docsSiteUrl}/#organization`;
const WEBSITE_ID = `${docsSiteUrl}/#website`;
const SOFTWARE_ID = `${docsSiteUrl}/#software`;

function publisherOrganization() {
  return {
    "@type": "Organization" as const,
    "@id": ORG_ID,
    name: "KitsuneKode",
    url: "https://github.com/KitsuneKode",
    logo: {
      "@type": "ImageObject" as const,
      url: docsCanonicalUrl("/apple-icon"),
    },
    sameAs: [
      "https://github.com/KitsuneKode",
      "https://github.com/KitsuneKode/kunai",
      "https://www.npmjs.com/package/@kitsunekode/kunai",
      "https://x.com/KitsuneKode",
    ],
  };
}

/**
 * JSON-LD is authored text inside a raw script sink: `JSON.stringify` alone
 * lets a `</script>` inside any string close the tag early. Escape `<` so the
 * payload can never leave the script element.
 */
export function serializeJsonLd<T>(data: T): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// No SearchAction: `/api/search` is JSON, not HTML, and Google retired sitelinks search boxes.
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: "Kunai Docs",
    url: docsCanonicalUrl("/"),
    inLanguage: "en",
    description: "Guides for Kunai playback, recovery, offline use, diagnostics, and reliability.",
    publisher: publisherOrganization(),
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
  readonly version?: string;
  readonly description: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": SOFTWARE_ID,
    name: "Kunai",
    url: docsCanonicalUrl("/"),
    description: input.description,
    // The same card the site shares, so a crawler that wants a picture of the
    // app is handed the one a person would see.
    image: `${docsSiteUrl}/opengraph-image`,
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "Command Line Media Player",
    operatingSystem: "Linux, macOS, Windows",
    ...(input.version ? { softwareVersion: input.version } : null),
    softwareRequirements: "mpv for desktop playback; yt-dlp for YouTube and downloads",
    downloadUrl: "https://github.com/KitsuneKode/kunai/releases/latest",
    installUrl: docsCanonicalUrl("/docs/users/install-and-update"),
    releaseNotes: docsCanonicalUrl("/releases"),
    softwareHelp: docsCanonicalUrl("/docs"),
    featureList: [
      "Search and stream anime, movies, TV series, and YouTube from the terminal",
      "Supervised mpv playback with resume, auto-advance, and multi-language audio and subtitles",
      "Automatic multi-provider failover and source switching",
      "Local-first SQLite watch history, watchlist, queue, and offline downloads",
      "Single-binary installs for Linux, macOS, Windows, and Android Termux",
    ],
    license: "https://github.com/KitsuneKode/kunai/blob/main/LICENSE",
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    author: publisherOrganization(),
  };
}

type SoftwareSourceCodeJsonLd = {
  "@context": "https://schema.org";
  "@type": "SoftwareSourceCode";
  name: string;
  codeRepository: string;
  programmingLanguage: string;
  runtimePlatform: string;
  license: string;
  version?: string;
  author: { "@id": string };
  targetProduct: { "@id": string };
};

export function softwareSourceCodeJsonLd(input: {
  readonly version?: string;
}): SoftwareSourceCodeJsonLd {
  const schema: SoftwareSourceCodeJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: "Kunai",
    codeRepository: "https://github.com/KitsuneKode/kunai",
    programmingLanguage: "TypeScript",
    runtimePlatform: "Bun",
    license: "https://github.com/KitsuneKode/kunai/blob/main/LICENSE",
    author: { "@id": ORG_ID },
    targetProduct: { "@id": SOFTWARE_ID },
  };
  if (input.version) schema.version = input.version;
  return schema;
}

export function webPageJsonLd(input: {
  readonly title: string;
  readonly description: string;
  readonly url: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.title,
    description: input.description,
    url: input.url,
    inLanguage: "en",
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORG_ID },
  };
}

type TechArticleJsonLd = {
  "@context": "https://schema.org";
  "@type": "TechArticle";
  headline: string;
  description: string;
  url: string;
  mainEntityOfPage: { "@type": "WebPage"; "@id": string };
  inLanguage: "en";
  image?: string;
  datePublished?: string;
  dateModified?: string;
  author: ReturnType<typeof publisherOrganization>;
  publisher: ReturnType<typeof publisherOrganization>;
};

export function techArticleJsonLd(input: {
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly image?: string;
  readonly datePublished?: string;
  readonly dateModified?: string;
}): TechArticleJsonLd {
  const org = publisherOrganization();
  const article: TechArticleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: input.title,
    description: input.description,
    url: input.url,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": input.url,
    },
    inLanguage: "en",
    author: org,
    publisher: org,
  };
  if (input.image) article.image = input.image;
  if (input.datePublished) article.datePublished = input.datePublished;
  if (input.dateModified) article.dateModified = input.dateModified;
  return article;
}

export function collectionPageJsonLd(input: {
  readonly title: string;
  readonly description: string;
  readonly url: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: input.title,
    description: input.description,
    url: input.url,
    inLanguage: "en",
    isPartOf: {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      name: "Kunai Docs",
      url: docsCanonicalUrl("/"),
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
