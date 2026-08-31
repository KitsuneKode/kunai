import { describe, expect, test } from "bun:test";

import { createBunHttpPort } from "../../../../src/runtime/android/bun-http-port";

describe("Bun Android HTTP port", () => {
  test("uses the requested deadline and reports bounded response bytes", async () => {
    const deadlines: number[] = [];
    let cancelled = false;
    const port = createBunHttpPort({
      fetch: async () => new Response("hello", { status: 200 }),
      scheduleTimeout: (_callback, milliseconds) => {
        deadlines.push(milliseconds);
        return 1;
      },
      cancelTimeout: () => {
        cancelled = true;
      },
    });

    await expect(
      port.request({
        method: "GET",
        url: "https://probe.example/status",
        timeoutMs: 8_000,
        maxBytes: 65_536,
      }),
    ).resolves.toEqual({ status: 200, bytes: 5 });
    expect(deadlines).toEqual([8_000]);
    expect(cancelled).toBe(true);
  });

  test("fails before returning an oversized response", async () => {
    const port = createBunHttpPort({
      fetch: async () => new Response("x".repeat(65_537), { status: 200 }),
    });

    await expect(
      port.request({
        method: "GET",
        url: "https://probe.example/status",
        timeoutMs: 8_000,
        maxBytes: 65_536,
      }),
    ).rejects.toThrow("response too large");
  });

  test("follows at most three HTTP(S) redirects manually", async () => {
    const requested: string[] = [];
    const port = createBunHttpPort({
      fetch: async (url, init) => {
        requested.push(String(url));
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 302,
          headers: { location: `/hop-${requested.length}` },
        });
      },
    });

    await expect(
      port.request({
        method: "GET",
        url: "https://probe.example/start",
        timeoutMs: 8_000,
        maxBytes: 65_536,
      }),
    ).rejects.toThrow("too many redirects");
    expect(requested).toHaveLength(4);
  });
});
