/**
 * The one way this site reads the public analytics endpoints.
 *
 * `/analytics` is statically prerendered, so these fetches run during `next
 * build` and on ISR revalidation — inside CI, against a host this repo does not
 * control at request time. A plain `fetch(...).json()` there has two unbounded
 * failure modes: a hung endpoint stalls the build until the CI runner's own
 * timeout kills it, and an oversized body is buffered into memory before a
 * single field is validated.
 *
 * Neither needs a hostile actor — a misconfigured deploy or a proxy returning
 * an HTML error page is enough. Both callers already treat `null` as "render
 * the empty state", so a rejected response degrades to the same well-tested
 * path as an unreachable one.
 */

/**
 * Generous against the real payloads and still far below anything that
 * threatens a build: 180 days of rollups is roughly 40 KB.
 */
export const MAX_RESPONSE_BYTES = 512 * 1024;

/** Long enough for a cold serverless start, short enough to fail a build fast. */
export const FETCH_TIMEOUT_MS = 8_000;

/**
 * Read a response body, refusing to buffer more than `MAX_RESPONSE_BYTES`.
 *
 * Streamed rather than `await response.text()`: a body that under-declares its
 * `content-length`, or omits it entirely, is still fully buffered by `text()`
 * before any length check could run. Counting bytes as they arrive is what
 * makes the cap real rather than advisory.
 */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;

  const body = response.body;
  if (!body) return null;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

/**
 * Fetch and parse one public analytics document.
 *
 * Returns `null` for every failure — unreachable, non-2xx, too slow, too
 * large, or not JSON. The caller decides what an absent document means; this
 * never throws and never returns a half-built value.
 */
export async function fetchAnalyticsJson(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await readCapped(response);
    if (text === null) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
