import { parsePublishedVersionTag } from "./version";

const DEFAULT_RELEASES_API = "https://api.github.com/repos/KitsuneKode/kunai/releases/latest";

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
  fetchImpl: typeof fetch = fetch,
  url: string = resolveReleasesApiUrl(),
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": "kunai-cli" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string };
    return parseVersionFromTag(body.tag_name);
  } catch {
    return null;
  }
}
