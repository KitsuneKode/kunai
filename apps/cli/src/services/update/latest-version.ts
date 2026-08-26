import { withTimeoutSignal } from "@/infra/abort/timeout-signal";

import { parsePublishedVersionTag } from "./version";

const DEFAULT_RELEASES_API = "https://api.github.com/repos/KitsuneKode/kunai/releases/latest";
export const UPDATE_METADATA_TIMEOUT_MS = 15_000;

export type MetadataFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function resolveReleasesApiUrl(): string {
  return process.env.KUNAI_RELEASES_API?.trim() || DEFAULT_RELEASES_API;
}

/**
 * Extract a strict `major.minor.patch` from a GitHub tag. Robust to both our
 * binary release tag (`v1.2.3`) and a changesets package tag
 * (`@kitsunekode/kunai@1.2.3`). Rejects prerelease, build, and leading-zero forms.
 */
export function parseVersionFromTag(tag: string | undefined): string | null {
  return parsePublishedVersionTag(tag);
}

/**
 * Resolve the latest released version from GitHub. Returns null on any
 * network/parse failure so callers can degrade gracefully. `fetchImpl` is
 * injectable for tests.
 */
export async function fetchLatestVersion(
  fetchImpl: MetadataFetch = fetch,
  url: string = resolveReleasesApiUrl(),
  signal: AbortSignal = withTimeoutSignal(undefined, UPDATE_METADATA_TIMEOUT_MS),
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "user-agent": "kunai-cli" },
      signal,
    });
    if (!res.ok) return null;
    // SAFETY: JSON stays untrusted; parseVersionFromTag strictly validates the only field consumed.
    const body = (await res.json()) as { tag_name?: string };
    return parseVersionFromTag(body.tag_name);
  } catch {
    return null;
  }
}
