import { blockedLiteralTargetReason } from "@kunai/types";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export type ResolveCatalogPosterUrlOptions = {
  /** TMDB size token, e.g. w500 for series posters in presence/detail surfaces. */
  readonly tmdbSize?: string;
};

/**
 * Normalize catalog poster candidates into a safe public HTTPS URL for Discord
 * large_image, terminal fetch, or other consumers. Rejects local paths and http.
 */
export function resolveCatalogPosterUrl(
  candidate: string | undefined | null,
  options: ResolveCatalogPosterUrlOptions = {},
): string | null {
  const trimmed = candidate?.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/")) {
    const size = options.tmdbSize ?? "w500";
    return `${TMDB_IMAGE_BASE}/${size}${trimmed}`;
  }

  if (trimmed.startsWith("file://")) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    // Literal private/loopback targets are provider-controlled SSRF surface —
    // DNS answers are re-checked at fetch time by the guarded remote fetch.
    if (blockedLiteralTargetReason(trimmed) !== null) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function resolveCatalogPosterUrlFromCandidates(
  candidates: readonly (string | undefined | null)[],
  options?: ResolveCatalogPosterUrlOptions,
): string | null {
  for (const candidate of candidates) {
    const resolved = resolveCatalogPosterUrl(candidate, options);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Admission check for provider-originated image/artwork refs — poster and
 * artwork fields on search results, episodes, and detail artwork candidates.
 * A value passes only as a remote http(s) URL on a public literal host, or a
 * single-segment TMDB-relative `/x.jpg`. Anything else (`file:`, UNC shares,
 * absolute local paths, private literals, bare filenames) is dropped so it can
 * never reach the local poster reader — `resolvePosterUrl` treats local-shaped
 * strings as filesystem paths by design for Kunai-produced artwork.
 *
 * `http:` is allowed at admission (providers legitimately emit http artwork);
 * surfaces that require https — Discord presence, catalog resolution — still
 * enforce it through {@link resolveCatalogPosterUrl}.
 */
export function sanitizeProviderArtworkRef(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (/^\/[^/]+$/.test(trimmed)) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return blockedLiteralTargetReason(trimmed) === null ? trimmed : undefined;
}
