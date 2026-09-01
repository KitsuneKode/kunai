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

  test("follows at most three HTTPS redirects manually", async () => {
    const requested: string[] = [];
    let cancelledBodies = 0;
    const port = createBunHttpPort({
      fetch: async (url, init) => {
        requested.push(String(url));
        expect(init?.redirect).toBe("manual");
        return new Response(
          new ReadableStream({
            cancel() {
              cancelledBodies += 1;
            },
          }),
          {
            status: 302,
            headers: { location: `/hop-${requested.length}` },
          },
        );
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
    expect(cancelledBodies).toBe(4);
  });

  test("cancels a redirect body before rejecting a missing location", async () => {
    let redirectBodyCancelled = false;
    const port = createBunHttpPort({
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              redirectBodyCancelled = true;
            },
          }),
          { status: 302 },
        ),
    });

    await expect(
      port.request({
        method: "GET",
        url: "https://probe.example/start",
        timeoutMs: 8_000,
        maxBytes: 65_536,
      }),
    ).rejects.toThrow("redirect missing location");
    expect(redirectBodyCancelled).toBe(true);
  });

  test("rejects plaintext initial URLs and HTTPS downgrade redirects", async () => {
    const port = createBunHttpPort({
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://probe.example/downgrade" },
        }),
    });

    for (const url of ["http://probe.example/start", "https://probe.example/start"]) {
      await expect(
        port.request({ method: "GET", url, timeoutMs: 8_000, maxBytes: 65_536 }),
      ).rejects.toThrow("credential-free HTTPS");
    }
  });

  test("rejects redirect targets with credentials, fragments, or controls", async () => {
    for (const location of [
      "https://user:password@redirect.example/path",
      "https://redirect.example/path#fragment",
      "https://redirect.example/a\tb",
    ]) {
      let requests = 0;
      const port = createBunHttpPort({
        fetch: async () => {
          requests += 1;
          return new Response(null, { status: 302, headers: { location } });
        },
      });

      await expect(
        port.request({
          method: "GET",
          url: "https://probe.example/start",
          timeoutMs: 8_000,
          maxBytes: 65_536,
        }),
      ).rejects.toThrow();
      expect(requests).toBe(1);
    }
  });

  test("cancels a redirect response body before following the next hop", async () => {
    let redirectBodyCancelled = false;
    let requests = 0;
    const port = createBunHttpPort({
      fetch: async () => {
        requests += 1;
        if (requests === 2) return new Response(null, { status: 204 });
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(65_536));
            },
            cancel() {
              redirectBodyCancelled = true;
            },
          }),
          { status: 302, headers: { location: "https://probe.example/final" } },
        );
      },
    });

    await expect(
      port.request({
        method: "GET",
        url: "https://probe.example/start",
        timeoutMs: 8_000,
        maxBytes: 65_536,
      }),
    ).resolves.toEqual({ status: 204, bytes: 0 });
    expect(redirectBodyCancelled).toBe(true);
  });
});
