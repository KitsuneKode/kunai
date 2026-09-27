import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

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

      // The file embeds signed CDN URLs — it and its dir stay owner-only in
      // the shared tmpdir.
      const playlistMode = (await stat(materialized!.stream.url)).mode & 0o777;
      const dirMode = (await stat(dirname(materialized!.stream.url))).mode & 0o777;
      expect(playlistMode).toBe(0o600);
      expect(dirMode).toBe(0o700);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("refuses a manifest body past the size cap", async () => {
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("#EXTM3U\n"));
        controller.enqueue(new Uint8Array(3 * 1024 * 1024));
        controller.close();
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(oversized, { status: 200 })) as unknown as typeof fetch;
    const skipped: Array<{ reason: string; detail?: string }> = [];
    try {
      const result = await materializeHlsManifestForPlayback(createHlsStream(), (reason, detail) =>
        skipped.push({ reason, detail }),
      );
      expect(result).toBeNull();
      expect(skipped).toEqual([
        { reason: "fetch-failed", detail: "manifest body exceeds 2097152 bytes" },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a caller abort cancels the manifest fetch", async () => {
    const originalFetch = globalThis.fetch;
    let observedSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal | undefined;
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as unknown as typeof fetch;
    const caller = new AbortController();
    caller.abort();
    try {
      const result = await materializeHlsManifestForPlayback(
        createHlsStream(),
        undefined,
        caller.signal,
      );
      expect(result).toBeNull();
      expect(observedSignal?.aborted).toBe(true);
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
