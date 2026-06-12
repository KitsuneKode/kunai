const RELEASES_API = "https://api.github.com/repos/KitsuneKode/kunai/releases/latest";

/**
 * Resolve the latest released version (GitHub `tag_name` like `v1.2.3` → `1.2.3`).
 * Returns null on any network/parse failure so callers can degrade gracefully.
 * `fetchImpl` is injectable for tests.
 */
export async function fetchLatestVersion(
  fetchImpl: typeof fetch = fetch,
  url: string = RELEASES_API,
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": "kunai-cli" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string };
    return body.tag_name ? body.tag_name.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}
