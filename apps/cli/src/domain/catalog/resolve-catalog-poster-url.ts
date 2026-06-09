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
