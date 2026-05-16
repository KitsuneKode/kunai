import { describe, expect, test } from "bun:test";

import { checkStreamHealth, type StreamHealthFetch } from "@/services/playback/stream-health-check";

function response(status: number): Response {
  return new Response(null, { status });
}

describe("checkStreamHealth", () => {
  test("returns healthy when HEAD succeeds and preserves provider headers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: StreamHealthFetch = async (url, init) => {
      calls.push({ url, init });
      return response(200);
    };

    const healthy = await checkStreamHealth({
      url: "https://cdn.example/stream.m3u8",
      headers: { referer: "https://provider.example", origin: "https://provider.example" },
      fetchImpl,
      timeoutMs: 50,
    });

    expect(healthy).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("HEAD");
    expect(calls[0]?.init.headers).toEqual({
      referer: "https://provider.example",
      origin: "https://provider.example",
    });
  });

  test("falls back to ranged GET when HEAD fails", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: StreamHealthFetch = async (url, init) => {
      calls.push({ url, init });
      if (init.method === "HEAD") throw new Error("method not allowed");
      return response(206);
    };

    const healthy = await checkStreamHealth({
      url: "https://cdn.example/stream.m3u8",
      headers: { referer: "https://provider.example" },
      fetchImpl,
      timeoutMs: 50,
    });

    expect(healthy).toBe(true);
    expect(calls.map((call) => call.init.method)).toEqual(["HEAD", "GET"]);
    expect(calls[1]?.init.headers).toEqual({
      referer: "https://provider.example",
      Range: "bytes=0-0",
    });
  });

  test("returns unhealthy when HEAD and ranged GET both fail", async () => {
    const fetchImpl: StreamHealthFetch = async (_url, init) => {
      if (init.method === "HEAD") return response(405);
      return response(404);
    };

    const healthy = await checkStreamHealth({
      url: "https://cdn.example/dead.m3u8",
      fetchImpl,
      timeoutMs: 50,
    });

    expect(healthy).toBe(false);
  });

  test("external abort cancels a slow health probe promptly", async () => {
    const controller = new AbortController();
    const calls: RequestInit[] = [];
    const fetchImpl: StreamHealthFetch = async (_url, init) => {
      calls.push(init);
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("cancelled", "AbortError")),
          { once: true },
        );
      });
    };

    const resultPromise = checkStreamHealth({
      url: "https://cdn.example/slow.m3u8",
      fetchImpl,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    controller.abort("user-cancelled");

    expect(await resultPromise).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls.every((call) => call.signal?.aborted)).toBe(true);
  });

  test("already-aborted health probe does not start a fetch", async () => {
    const controller = new AbortController();
    controller.abort("user-cancelled");
    let calls = 0;

    const healthy = await checkStreamHealth({
      url: "https://cdn.example/slow.m3u8",
      fetchImpl: async () => {
        calls += 1;
        return response(200);
      },
      timeoutMs: 5_000,
      signal: controller.signal,
    });

    expect(healthy).toBe(false);
    expect(calls).toBe(0);
  });
});
