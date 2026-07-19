import { describe, expect, test } from "bun:test";

import { HLS_SEGMENT_PROBE_MIN_BYTES } from "../src/shared/hls-manifest";
import {
  isStreamReachableForPlaybackPreflight,
  isStreamReachableForResolve,
  probeStreamReachability,
  shouldAbortPlaybackForPreflight,
} from "../src/shared/stream-reachability";

function response(
  status: number,
  body: string | Uint8Array = "",
  headers?: Record<string, string>,
): Response {
  return new Response(body, { status, headers });
}

function mediaBytes(size = HLS_SEGMENT_PROBE_MIN_BYTES): Uint8Array {
  return new Uint8Array(size).fill(0xab);
}

describe("stream reachability", () => {
  test("HLS media playlists probe first media segment after playlist fetch", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.endsWith("stream.m3u8")) {
        return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.jpg\n");
      }
      expect(init.headers).toMatchObject({
        Range: `bytes=0-${HLS_SEGMENT_PROBE_MIN_BYTES - 1}`,
      });
      return response(206, mediaBytes());
    };

    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      headers: { referer: "https://provider.example" },
      fetchImpl,
      timeoutMs: 200,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(urls).toEqual(["https://cdn.example/stream.m3u8", "https://cdn.example/seg-1.jpg"]);
  });

  test("HLS master playlists follow video variant then media segment", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.endsWith("master.m3u8")) {
        return response(
          200,
          [
            "#EXTM3U",
            "#EXT-X-STREAM-INF:BANDWIDTH=800000",
            "index-v1-a1.m3u8",
            "#EXT-X-STREAM-INF:BANDWIDTH=400000",
            "index-a1.m3u8",
          ].join("\n"),
        );
      }
      if (url.endsWith("index-v1-a1.m3u8")) {
        return response(200, "#EXTM3U\n#EXTINF:4,\nseg-1-v1-a1.ts.html\n");
      }
      return response(206, mediaBytes());
    };

    const probe = await probeStreamReachability({
      url: "https://cdn.example/token/master.m3u8",
      fetchImpl,
      timeoutMs: 500,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(urls).toEqual([
      "https://cdn.example/token/master.m3u8",
      "https://cdn.example/token/index-v1-a1.m3u8",
      "https://cdn.example/token/seg-1-v1-a1.ts.html",
    ]);
  });

  test("HLS segment probe fails when first segment is unreachable", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      headers: { referer: "https://provider.example" },
      fetchImpl: async (url: string) => {
        if (url.endsWith("stream.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.jpg\n");
        }
        return response(404, "missing");
      },
      timeoutMs: 200,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("HLS segment unreachable");
    }
    expect(isStreamReachableForResolve(probe)).toBe(false);
  });

  test("master OK + segment 403 is unreachable", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/master.m3u8",
      fetchImpl: async (url: string) => {
        if (url.endsWith("master.m3u8")) {
          return response(200, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex-v1.m3u8\n");
        }
        if (url.endsWith("index-v1.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg.ts\n");
        }
        return response(403, "blocked");
      },
      timeoutMs: 500,
    });

    expect(probe.status).toBe("unreachable");
    expect(isStreamReachableForResolve(probe)).toBe(false);
  });

  test("junk tiny segment body is unreachable", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      fetchImpl: async (url: string) => {
        if (url.endsWith("stream.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.jpg\n");
        }
        return response(200, "x", { "content-type": "application/octet-stream" });
      },
      timeoutMs: 200,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("body too small");
      expect(probe.definitive).toBe(true);
    }
  });

  test("HTML content-type on segment is unreachable", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      fetchImpl: async (url: string) => {
        if (url.endsWith("stream.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.jpg\n");
        }
        return response(200, mediaBytes(), { "content-type": "text/html; charset=utf-8" });
      },
      timeoutMs: 200,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("text/html");
    }
  });

  test("abort mid-probe returns timeout", async () => {
    const controller = new AbortController();
    const probe = await probeStreamReachability({
      url: "https://cdn.example/master.m3u8",
      signal: controller.signal,
      fetchImpl: async () => {
        controller.abort();
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      },
      timeoutMs: 500,
    });

    expect(probe).toEqual({ status: "timeout" });
  });

  test("resolve gate rejects definitive unreachable probes", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/dead.m3u8",
      fetchImpl: async () => response(403, "blocked"),
      timeoutMs: 50,
    });

    expect(probe.status).toBe("unreachable");
    expect(isStreamReachableForResolve(probe)).toBe(false);
    expect(isStreamReachableForPlaybackPreflight(probe)).toBe(false);
    expect(shouldAbortPlaybackForPreflight(probe, false)).toBe(true);
  });

  test("playback preflight stays lenient on timeout", async () => {
    const probe = { status: "timeout" } as const;
    expect(isStreamReachableForResolve(probe)).toBe(true);
    expect(isStreamReachableForPlaybackPreflight(probe)).toBe(true);
    expect(shouldAbortPlaybackForPreflight(probe, false)).toBe(false);
  });

  test("non-HLS URLs fall back from HEAD to ranged GET", async () => {
    const methods: string[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      methods.push(String(init.method));
      if (init.method === "HEAD") return response(405);
      return response(206);
    };

    const probe = await probeStreamReachability({
      url: "https://cdn.example/movie.mp4",
      fetchImpl,
      timeoutMs: 50,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(methods).toEqual(["HEAD", "GET"]);
  });
});
