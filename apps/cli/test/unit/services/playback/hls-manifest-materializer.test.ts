import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { StreamInfo } from "@/domain/types";
import {
  isTerminalHlsHttpStatus,
  materializeHlsManifestForPlayback,
} from "@/services/playback/hls-manifest-materializer";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("hls manifest materializer", () => {
  test("classifies only terminal client responses as pre-player rejection", () => {
    expect(isTerminalHlsHttpStatus(401)).toBe(true);
    expect(isTerminalHlsHttpStatus(403)).toBe(true);
    expect(isTerminalHlsHttpStatus(404)).toBe(true);
    expect(isTerminalHlsHttpStatus(410)).toBe(true);
    expect(isTerminalHlsHttpStatus(429)).toBe(false);
    expect(isTerminalHlsHttpStatus(503)).toBe(false);
    expect(isTerminalHlsHttpStatus(undefined)).toBe(false);
  });

  test("reports the HTTP status when a manifest request is rejected", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    const skipped: Array<{ reason: string; detail?: string; status?: number }> = [];
    try {
      const result = await materializeHlsManifestForPlayback(
        createHlsStream(),
        (reason, detail, status) => skipped.push({ reason, detail, status }),
      );
      expect(result).toBeNull();
      expect(skipped).toEqual([{ reason: "http-error", detail: "HTTP 403", status: 403 }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("skips materialize for fingerprint-relay CDN hosts", async () => {
    const stream: StreamInfo = {
      url: "https://vault-06.uwucdn.top/path/index.m3u8",
      headers: { Referer: "https://kwik.cx/" },
      title: "Test",
      timestamp: Date.now(),
    };
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response("#EXTM3U\n", { status: 200 });
    }) as unknown as typeof fetch;
    try {
      expect(await materializeHlsManifestForPlayback(stream)).toBeNull();
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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

function createHlsStream(): StreamInfo {
  return {
    url: "https://light.goldweather.net/token/index.m3u8",
    headers: { Referer: "https://player.example/" },
    title: "Test",
    timestamp: Date.now(),
  };
}
