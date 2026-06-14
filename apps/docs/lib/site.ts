/**
 * Public docs site origin. Set `DOCS_SITE_URL` in production for canonical URLs,
 * sitemap, and Open Graph (e.g. https://docs.kunai.example).
 */
export const docsSiteUrl = (process.env.DOCS_SITE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

export function docsCanonicalUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${docsSiteUrl}${normalized}`;
}
