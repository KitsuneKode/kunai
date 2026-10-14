import { afterEach, describe, expect, test } from "bun:test";

import { createRealDebridPort } from "@/services/debrid/realdebrid";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// SAFETY: test stubs — replace global fetch with canned Real-Debrid responses.
function stubFetch(
  handler: (input: string, init?: RequestInit) => Promise<Response> | Response,
): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    return handler(String(input), init);
  }) as typeof fetch;
}

describe("experimental debrid unrestrict", () => {
  test("refuses an empty token without touching the network", async () => {
    expect(() => createRealDebridPort("  ")).toThrow("debrid token is missing");
  });

  test("adds, selects, polls, and unrestricts a magnet", async () => {
    const calls: string[] = [];
    let polls = 0;
    stubFetch(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/torrents/addMagnet")) return jsonResponse({ id: "t1" });
      if (url.includes("/torrents/selectFiles/")) return jsonResponse({});
      if (url.includes("/torrents/info/")) {
        polls += 1;
        if (polls < 2) return jsonResponse({ id: "t1", status: "downloading", progress: 40 });
        return jsonResponse({ id: "t1", status: "downloaded", links: ["https://rd.link/f"] });
      }
      if (url.endsWith("/unrestrict/link")) {
        return jsonResponse({ download: "https://cdn.example/file.mp4" });
      }
      return jsonResponse({}, 404);
    });

    const downloadUrl = await createRealDebridPort("token").unrestrict("magnet:?xt=urn:btih:abc");
    expect(downloadUrl).toBe("https://cdn.example/file.mp4");
    expect(calls.some((call) => call.includes("/torrents/addMagnet"))).toBe(true);
    expect(calls.some((call) => call.includes("/unrestrict/link"))).toBe(true);
  });

  test("surfaces upstream failure states honestly", async () => {
    stubFetch(async (url) => {
      if (url.endsWith("/torrents/addMagnet")) return jsonResponse({ id: "t1" });
      if (url.includes("/torrents/selectFiles/")) return jsonResponse({});
      return jsonResponse({ id: "t1", status: "error" });
    });

    await expect(
      createRealDebridPort("token").unrestrict("magnet:?xt=urn:btih:abc"),
    ).rejects.toThrow("debrid torrent failed: error");
  });

  test("an HTTP refusal names the stage", async () => {
    stubFetch(async () => new Response("denied", { status: 401 }));

    await expect(createRealDebridPort("bad").unrestrict("magnet:?xt=urn:btih:abc")).rejects.toThrow(
      "debrid add-magnet failed: HTTP 401",
    );
  });
});

describe("magnet detection", () => {
  test("recognizes magnet links and rejects titles", async () => {
    const { isTorrentMagnetLink } = await import("@/app/torrent/torrent-playback");
    expect(isTorrentMagnetLink("magnet:?xt=urn:btih:abc123")).toBe(true);
    expect(isTorrentMagnetLink("  MAGNET:?xt=urn:btih:abc123 ")).toBe(true);
    expect(isTorrentMagnetLink("Dune Part Two")).toBe(false);
    expect(isTorrentMagnetLink("https://example.com/x.torrent")).toBe(false);
  });
});
