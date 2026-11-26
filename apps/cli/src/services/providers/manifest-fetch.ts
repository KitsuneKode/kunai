import { isSafeManifestHttpsUrl } from "@kunai/providers";

export type ManifestFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function releaseUnreadBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

const MAX_MANIFEST_REDIRECTS = 5;

/**
 * GitHub release downloads answer 302 to their asset CDN, so a pinned release
 * URL needs redirects. Each hop is followed by hand and must pass the same
 * HTTPS-and-public-target guard as the original URL; the manifest's signature
 * is still what decides trust.
 */
export async function fetchManifestResponse(
  fetchFn: ManifestFetch,
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop += 1) {
    const init: RequestInit = {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal,
    };
    const response = await fetchFn(current, init);
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    await releaseUnreadBody(response);
    if (!location) throw new Error(`HTTP ${response.status} without a Location`);
    if (hop >= MAX_MANIFEST_REDIRECTS) throw new Error("too many redirects");
    const next = new URL(location, current).toString();
    if (!isSafeManifestHttpsUrl(next)) throw new Error("redirect to an unsafe target");
    current = next;
  }
}
