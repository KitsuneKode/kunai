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
