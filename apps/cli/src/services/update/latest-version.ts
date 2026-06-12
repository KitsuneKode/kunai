const RELEASES_API = "https://api.github.com/repos/KitsuneKode/kunai/releases/latest";

/**
 * Extract a `major.minor.patch` from a GitHub tag. Robust to both our binary
 * release tag (`v1.2.3`) and a changesets package tag (`@kitsunekode/kunai@1.2.3`),
 * so the upgrade check keeps working regardless of which release is "latest".
 */
export function parseVersionFromTag(tag: string | undefined): string | null {
  if (!tag) return null;
  const match = tag.match(/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

/**
 * Resolve the latest released version from GitHub. Returns null on any
 * network/parse failure so callers can degrade gracefully. `fetchImpl` is
 * injectable for tests.
 */
export async function fetchLatestVersion(
  fetchImpl: typeof fetch = fetch,
  url: string = RELEASES_API,
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
