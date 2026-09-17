/**
 * Reading a provider's JSON response at the boundary, so no adapter has to
 * guess what came back.
 *
 * A provider API answering `HTTP 200` with the body `null` is normal, not
 * exotic: VidLink does it for every title while its backend has nothing to
 * offer (observed 2026-09-12). `(await response.json()) as { stream?: … }`
 * types that away, and the next property read throws `null is not an object` —
 * which surfaces as a crash inside resolve rather than "this provider has no
 * source", so the lane blames itself instead of falling through.
 */

/**
 * The response body when it is a JSON object (or array), else null.
 *
 * Returning null for `null`, a bare string, or a number keeps the decision at
 * the one place that has the raw body; callers branch on the domain value
 * (`if (!data?.stream)`) instead of trusting a cast.
 */
export async function readJsonObjectBody<T>(response: Response): Promise<T | null> {
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object") return null;
  return body as T;
}
