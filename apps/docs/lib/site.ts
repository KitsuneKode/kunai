/**
 * Public docs site origin — the base for canonical URLs, the sitemap, robots,
 * Open Graph, and `llms.txt`.
 *
 * `DOCS_SITE_URL` is the explicit answer and always wins. Without it a deploy
 * used to fall straight through to `http://localhost:3000` and publish that
 * origin in every canonical tag and sitemap entry, which is invisible locally
 * and wrong the moment the site is hosted. The Vercel-provided origins are the
 * honest middle ground: the production alias when the deployment has one, then
 * the per-deployment URL for previews.
 */
function resolveDocsSiteUrl(env: Record<string, string | undefined>): string {
  const explicit = env.DOCS_SITE_URL?.trim();
  if (explicit) return explicit;

  const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost}`;

  const deploymentHost = env.VERCEL_URL?.trim();
  if (deploymentHost) return `https://${deploymentHost}`;

  return "http://localhost:3000";
}

export function docsSiteUrlFrom(env: Record<string, string | undefined>): string {
  return resolveDocsSiteUrl(env).replace(/\/$/, "");
}

export const docsSiteUrl = docsSiteUrlFrom(process.env);

export function docsCanonicalUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${docsSiteUrl}${normalized}`;
}
