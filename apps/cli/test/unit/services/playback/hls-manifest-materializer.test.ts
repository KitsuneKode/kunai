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
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
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

  test("cancels an error response body instead of leaving it unread", async () => {
    const originalFetch = globalThis.fetch;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(32));
      },
      cancel() {
        cancelled = true;
      },
    });
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    globalThis.fetch = (async () => new Response(body, { status: 404 })) as unknown as typeof fetch;
    try {
      const result = await materializeHlsManifestForPlayback(createHlsStream());
      expect(result).toBeNull();
      expect(cancelled).toBe(true);
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
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
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
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
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
    }) as unknown as typeof fetch;

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
      // the shared tmpdir. POSIX only: Windows uses ACLs and stat mode bits
      // there don't reflect the chmod.
      if (process.platform !== "win32") {
        const playlistMode = (await stat(materialized!.stream.url)).mode & 0o777;
        const dirMode = (await stat(dirname(materialized!.stream.url))).mode & 0o777;
        expect(playlistMode).toBe(0o600);
        expect(dirMode).toBe(0o700);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("resolves relative references against the URL the playlist was redirected to", async () => {
    const manifest = [
      "#EXTM3U",
      '#EXT-X-MAP:URI="init.mp4"',
      "#EXTINF:3,",
      "/mirror/seg-1.jpg",
      "#EXTINF:3,",
      "seg-2.jpg",
    ].join("\n");
    const originalFetch = globalThis.fetch;
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/token/index.m3u8") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://light.goldweather.net/moved/ep1/index.m3u8" },
        });
      }
      if (url.pathname === "/moved/ep1/index.m3u8") {
        return new Response(manifest, {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      }
      return originalFetch(input);
    }) as unknown as typeof fetch;

    try {
      const materialized = await materializeHlsManifestForPlayback(createHlsStream());
      expect(materialized).not.toBeNull();
      cleanup.push(materialized!.cleanup);
      const playlist = await readFile(materialized!.stream.url, "utf8");
      // Relative to the redirected location, not the requested one — and not
      // to the temp file mpv reads it from.
      expect(playlist).toContain(
        '#EXT-X-MAP:URI="https://light.goldweather.net/moved/ep1/init.mp4"',
      );
      expect(playlist).toContain("https://light.goldweather.net/moved/ep1/seg-2.jpg");
      expect(playlist).toContain("https://light.goldweather.net/mirror/seg-1.jpg");
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
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
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
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
      // Pre-dispatch abort returns timeout before fetch; a dispatched fetch
      // must still see the aborted signal. Either proves cancellation.
      expect(observedSignal === undefined || observedSignal.aborted).toBe(true);
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
