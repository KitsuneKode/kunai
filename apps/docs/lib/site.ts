/**
 * Public docs site origin — the base for canonical URLs, the sitemap, robots,
 * Open Graph, and `llms.txt`.
 *
 * `DOCS_SITE_URL` explicitly overrides the public origin (including local smoke
 * builds). Otherwise deployment aliases and localhost must never become the
 * canonical identity of a public guide. Preview builds also declare noindex.
 */
function resolveDocsSiteUrl(env: Record<string, string | undefined>): string {
  const explicit = env.DOCS_SITE_URL?.trim();
  if (explicit) {
    const url = new URL(explicit);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "DOCS_SITE_URL must be an HTTP(S) origin without credentials, path, query or fragment",
      );
    }
    return url.origin;
  }
  return "https://kunai.kitsunekode.in";
}

export function docsSiteUrlFrom(env: Record<string, string | undefined>): string {
  return resolveDocsSiteUrl(env).replace(/\/$/, "");
}

export const docsSiteUrl = docsSiteUrlFrom(process.env);

export function docsCanonicalUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${docsSiteUrl}${normalized}`;
}
