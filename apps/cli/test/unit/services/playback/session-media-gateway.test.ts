import { describe, expect, test } from "bun:test";

import type { StreamInfo } from "@/domain/types";
import {
  createGatewayResourceRegistry,
  createSessionMediaGatewayHandler,
  rewriteDashManifestForGateway,
  rewriteHlsManifestForGateway,
} from "@/services/playback/cast/session-media-gateway";

const UPSTREAM = "https://media.example/path/master.m3u8?session=abc";
const ORIGIN = "http://192.168.0.10:43123";

function stream(headers: Record<string, string> = {}): StreamInfo {
  return { url: UPSTREAM, headers, timestamp: 1 };
}

describe("session-scoped Cast media gateway", () => {
  test("creates a fresh high-entropy path token for every playback session", () => {
    const first = createGatewayResourceRegistry(UPSTREAM);
    const second = createGatewayResourceRegistry(UPSTREAM);

    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThanOrEqual(43);
    expect(second.token.length).toBeGreaterThanOrEqual(43);
  });

  test("rewrites HLS variants, segments, keys, and maps into opaque token routes", () => {
    const registry = createGatewayResourceRegistry(UPSTREAM, "session-token");
    const rewritten = rewriteHlsManifestForGateway(
      [
        "#EXTM3U",
        '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
        '#EXT-X-MAP:URI="init.mp4"',
        "variant/playlist.m3u8",
        "segment-01.ts?sig=one",
      ].join("\n"),
      UPSTREAM,
      ORIGIN,
      registry,
    );

    expect(rewritten).not.toContain("media.example");
    expect(
      rewritten.match(/http:\/\/192\.168\.0\.10:43123\/cast\/session-token\/[a-z0-9]+/g),
    ).toHaveLength(4);
    expect(registry.resolve("2")).toBe("https://media.example/path/keys/key.bin");
    expect(registry.resolve("4")).toBe("https://media.example/path/variant/playlist.m3u8");
  });

  test("rewrites DASH BaseURL and segment template attributes", () => {
    const registry = createGatewayResourceRegistry(
      "https://media.example/dash/master.mpd",
      "session-token",
    );
    const rewritten = rewriteDashManifestForGateway(
      '<MPD><BaseURL>video/</BaseURL><SegmentTemplate initialization="init.mp4" media="chunk-$Number$.m4s" /></MPD>',
      "https://media.example/dash/master.mpd",
      ORIGIN,
      registry,
    );

    expect(rewritten).not.toContain("video/");
    expect(rewritten).not.toContain('initialization="init.mp4"');
    expect(rewritten).toContain(`/cast/session-token/`);
  });

  test("requires the session token and never accepts a client-supplied upstream URL", async () => {
    const registry = createGatewayResourceRegistry(UPSTREAM, "secret-token");
    let fetches = 0;
    const handler = createSessionMediaGatewayHandler({
      stream: stream(),
      registry,
      origin: () => ORIGIN,
      fetchUpstream: async () => {
        fetches += 1;
        return new Response("unexpected");
      },
    });

    expect((await handler(new Request(`${ORIGIN}/cast/wrong/${registry.initialId}`))).status).toBe(
      404,
    );
    expect(
      (await handler(new Request(`${ORIGIN}/cast/secret-token/https%3A%2F%2Fevil.example%2Fvideo`)))
        .status,
    ).toBe(404);
    expect(fetches).toBe(0);
  });

  test("forwards provider headers and byte ranges while rewriting fetched manifests", async () => {
    const registry = createGatewayResourceRegistry(UPSTREAM, "secret-token");
    const requests: Array<{ url: string; headers: Headers }> = [];
    const handler = createSessionMediaGatewayHandler({
      stream: stream({ Referer: "https://provider.example/watch", Cookie: "sid=private" }),
      registry,
      origin: () => ORIGIN,
      fetchUpstream: async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), headers: new Headers(init?.headers) });
        return new Response("#EXTM3U\nsegments/one.ts", {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      },
    });

    const response = await handler(
      new Request(`${ORIGIN}/cast/secret-token/${registry.initialId}`, {
        headers: { Range: "bytes=0-1023" },
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(requests[0]?.url).toBe(UPSTREAM);
    expect(requests[0]?.headers.get("referer")).toBe("https://provider.example/watch");
    expect(requests[0]?.headers.get("cookie")).toBe("sid=private");
    expect(requests[0]?.headers.get("range")).toBe("bytes=0-1023");
    expect(body).toMatch(new RegExp(`${ORIGIN}/cast/secret-token/[a-z0-9]+`));
  });

  test("returns generic failure bodies and becomes unavailable after close", async () => {
    const registry = createGatewayResourceRegistry(UPSTREAM, "secret-token");
    let closed = false;
    const handler = createSessionMediaGatewayHandler({
      stream: stream(),
      registry,
      origin: () => ORIGIN,
      isClosed: () => closed,
      fetchUpstream: async () => {
        throw new Error(`sensitive upstream URL: ${UPSTREAM}`);
      },
    });
    const request = new Request(`${ORIGIN}/cast/secret-token/${registry.initialId}`);

    const failed = await handler(request);
    expect(failed.status).toBe(502);
    expect(await failed.text()).toBe("upstream fetch failed");
    closed = true;
    expect((await handler(request)).status).toBe(404);
  });
});
