import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { StreamInfo } from "@/domain/types";
import {
  absolutizeHostRootHlsManifest,
  manifestUsesHostRootSegmentPaths,
  materializeHlsManifestForPlayback,
} from "@/services/playback/hls-manifest-materializer";
import { shouldMaterializeHlsManifest } from "@kunai/providers";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("hls manifest materializer", () => {
  test("detects host-root segment paths", () => {
    expect(
      manifestUsesHostRootSegmentPaths(
        ["#EXTM3U", "#EXTINF:3,", "/segment-a/seg-1.jpg", "#EXTINF:3,", "relative/seg.ts"].join(
          "\n",
        ),
      ),
    ).toBe(true);
    expect(
      manifestUsesHostRootSegmentPaths(["#EXTM3U", "#EXTINF:3,", "relative/seg.ts"].join("\n")),
    ).toBe(false);
  });

  test("absolutizes host-root segment paths against manifest origin", () => {
    const output = absolutizeHostRootHlsManifest(
      ["#EXTM3U", "#EXTINF:3,", "/foo/bar/seg.jpg"].join("\n"),
      "https://light.goldweather.net/token/index.m3u8",
    );
    expect(output).toContain("https://light.goldweather.net/foo/bar/seg.jpg");
  });

  test("materializes host-root playlists on known CDNs or large manifests", () => {
    const hostRoot = ["#EXTM3U", "#EXTINF:3,", "/mirror/seg-1.jpg"].join("\n");
    expect(
      shouldMaterializeHlsManifest(
        "https://light.goldweather.net/token/aW5kZXgubTN1OA==.m3u8",
        hostRoot,
      ),
    ).toBe(true);
    expect(shouldMaterializeHlsManifest("https://cdn.example/master.m3u8", hostRoot)).toBe(false);
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
