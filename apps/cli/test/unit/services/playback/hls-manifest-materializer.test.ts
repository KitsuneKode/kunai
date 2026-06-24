import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { StreamInfo } from "@/domain/types";
import { materializeHlsManifestForPlayback } from "@/services/playback/hls-manifest-materializer";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("hls manifest materializer", () => {
  test("materializes a fetched manifest into a local playlist file", async () => {
    const manifest = ["#EXTM3U", "#EXTINF:3,", "/mirror/seg-1.jpg"].join("\n");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname === "light.goldweather.net") {
        return new Response(manifest, {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      }
      return originalFetch(input);
    }) as typeof fetch;

    const stream: StreamInfo = {
      url: "https://light.goldweather.net/token/index.m3u8",
      headers: {
        referer: "https://www.cineplay.to/tv/1/1/1",
        origin: "https://www.cineplay.to",
      },
      title: "Test",
      timestamp: Date.now(),
    };

    try {
      const materialized = await materializeHlsManifestForPlayback(stream);
      expect(materialized).not.toBeNull();
      cleanup.push(materialized!.cleanup);

      expect(materialized!.stream.url.endsWith("playlist.m3u8")).toBe(true);
      expect(existsSync(materialized!.stream.url)).toBe(true);

      const playlist = await readFile(materialized!.stream.url, "utf8");
      expect(playlist).toContain("https://light.goldweather.net/mirror/seg-1.jpg");
      expect(materialized!.stream.headers).toEqual(stream.headers);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
