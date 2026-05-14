import { describe, expect, test } from "bun:test";

import { StreamHealthService } from "@/services/playback/StreamHealthService";

describe("StreamHealthService", () => {
  test("preserves provider headers while checking stale HLS manifests", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const service = new StreamHealthService({
      now: () => 10_000_000,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response("", { status: 200 });
      },
    });

    const result = await service.check({
      url: "https://cdn.example/master.m3u8",
      timestamp: 10_000_000 - 3 * 60 * 60 * 1000,
      headers: { Referer: "https://provider.example/watch", "User-Agent": "Kunai" },
    });

    expect(result).toMatchObject({
      checked: true,
      healthy: true,
      strategy: "hls-manifest-get",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.headers).toEqual({
      Referer: "https://provider.example/watch",
      "User-Agent": "Kunai",
    });
  });

  test("falls back from HEAD to ranged GET for stale direct files", async () => {
    const methods: string[] = [];
    const service = new StreamHealthService({
      now: () => 10_000_000,
      fetchImpl: async (_url, init) => {
        methods.push(String(init.method));
        return new Response("", { status: methods.length === 1 ? 405 : 206 });
      },
    });

    const result = await service.check({
      url: "https://cdn.example/movie.mp4",
      timestamp: 10_000_000 - 3 * 60 * 60 * 1000,
      headers: {},
    });

    expect(result.healthy).toBe(true);
    expect(methods).toEqual(["HEAD", "GET"]);
  });
});
