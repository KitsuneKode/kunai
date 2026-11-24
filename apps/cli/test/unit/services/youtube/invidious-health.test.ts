import { afterEach, describe, expect, test } from "bun:test";

import { probeInvidiousHealth } from "@/services/youtube/invidious-health";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("probeInvidiousHealth", () => {
  test("cancels the stats body when the instance answers with an error", async () => {
    let cancelled = false;
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(16));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 502 });
    }) as unknown as typeof fetch;

    const result = await probeInvidiousHealth({
      preferredInstanceUrl: "https://invidious.example",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP 502");
    expect(cancelled).toBe(true);
  });
});
