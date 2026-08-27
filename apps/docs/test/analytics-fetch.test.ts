import { describe, expect, test } from "bun:test";

import { fetchAnalyticsJson, FETCH_TIMEOUT_MS, MAX_RESPONSE_BYTES } from "../lib/analytics-fetch";

/** A `typeof fetch`-shaped stub, so the tests type-check like the real call site. */
const stub = (handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch =>
  ((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as unknown as typeof fetch;

function jsonResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("fetchAnalyticsJson", () => {
  test("parses a well-formed document", async () => {
    const result = await fetchAnalyticsJson(
      "https://example.test/daily.json",
      stub(async () => jsonResponse(JSON.stringify({ ok: true }))),
    );
    expect(result).toEqual({ ok: true });
  });

  test("a non-2xx response is absent, not a throw", async () => {
    const result = await fetchAnalyticsJson(
      "https://example.test/daily.json",
      stub(async () => new Response("nope", { status: 503 })),
    );
    expect(result).toBeNull();
  });

  test("a body that is not JSON is absent", async () => {
    // A proxy returning an HTML error page is the common real case.
    const result = await fetchAnalyticsJson(
      "https://example.test/daily.json",
      stub(async () => jsonResponse("<!doctype html><title>502</title>")),
    );
    expect(result).toBeNull();
  });

  test("an oversized body is rejected on its declared length alone", async () => {
    const result = await fetchAnalyticsJson(
      "https://example.test/daily.json",
      stub(async () => jsonResponse("{}", { "content-length": String(MAX_RESPONSE_BYTES + 1) })),
    );
    expect(result).toBeNull();
  });

  test("an oversized body is rejected even when it under-declares its length", async () => {
    // The reason the cap counts streamed bytes instead of trusting the header:
    // `response.text()` would buffer the whole thing before any check could run.
    const huge = `{"pad":"${"x".repeat(MAX_RESPONSE_BYTES + 1024)}"}`;
    const result = await fetchAnalyticsJson(
      "https://example.test/daily.json",
      stub(async () => jsonResponse(huge, { "content-length": "2" })),
    );
    expect(result).toBeNull();
  });

  test("a body just under the cap still parses", async () => {
    const pad = "y".repeat(MAX_RESPONSE_BYTES - 64);
    const result = await fetchAnalyticsJson(
      "https://example.test/daily.json",
      stub(async () => jsonResponse(`{"pad":"${pad}"}`)),
    );
    expect(result).toEqual({ pad });
  });

  test("a hung endpoint is abandoned rather than stalling the build", async () => {
    const result = await fetchAnalyticsJson(
      "https://example.test/daily.json",
      stub(async (_url, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        // Whatever the caller does with the signal, a rejection must degrade to null.
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    expect(result).toBeNull();
  });

  test("carries a deadline and an ISR revalidate window", async () => {
    let seen: RequestInit | undefined;
    await fetchAnalyticsJson(
      "https://example.test/daily.json",
      stub(async (_url, init) => {
        seen = init;
        return jsonResponse("{}");
      }),
    );
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect((seen as { next?: { revalidate?: number } } | undefined)?.next?.revalidate).toBe(3600);
    expect(FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
