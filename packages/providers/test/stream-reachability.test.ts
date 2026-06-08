import { describe, expect, test } from "bun:test";

import {
  isStreamReachableForPlaybackPreflight,
  isStreamReachableForResolve,
  probeStreamReachability,
  shouldAbortPlaybackForPreflight,
} from "../src/shared/stream-reachability";

function response(status: number, body = ""): Response {
  return new Response(body, { status });
}

describe("stream reachability", () => {
  test("HLS manifests use GET and accept 200 playlists", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      calls.push(init);
      return response(200, "#EXTM3U\n#EXT-X-VERSION:3\n");
    };

    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      headers: { referer: "https://provider.example" },
      fetchImpl,
      timeoutMs: 50,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
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
    expect(isStreamReachableForResolve(probe)).toBe(false);
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
