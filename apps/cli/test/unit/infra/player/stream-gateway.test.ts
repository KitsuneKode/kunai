import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";

import {
  createStreamGateway,
  type StreamGateway,
  type StreamGatewayOptions,
} from "@/infra/player/stream-gateway";

type RecordedCall = { readonly url: string; readonly headers: Record<string, string> };

function recordingFetch(bodies: Record<string, { body: string; contentType?: string }>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ url, headers });
    const fixture = bodies[url];
    if (!fixture) return new Response("missing", { status: 404 });
    return new Response(fixture.body, {
      headers: { "content-type": fixture.contentType ?? "application/octet-stream" },
    });
  };
  return { calls, fetchImpl };
}

function start(options: StreamGatewayOptions): StreamGateway {
  return createStreamGateway(options);
}

const MASTER_URL = "https://cdn.example.com/master.m3u8";
const PLAYLIST_BODY = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/k.bin",IV=0x1',
  "#EXTINF:6.0,",
  "seg-0.ts",
  "https://seg2.cdn.example.com/seg-1.ts",
  "#EXT-X-ENDLIST",
].join("\n");

describe("android stream gateway", () => {
  test("requests without a session token get 404", async () => {
    const gw = start({ fetchImpl: async () => new Response("x") });
    try {
      for (const path of ["/", "/media", "/g/deadbeef/media", "/g/abc/f/AAAA"]) {
        const res = await fetch(`${gw.baseUrl}${path}`);
        expect(res.status).toBe(404);
      }
    } finally {
      gw.stop();
    }
  });

  test("a wrong token cannot reach a registered session", async () => {
    const gw = start({ fetchImpl: recordingFetch({}).fetchImpl });
    try {
      const session = gw.registerSession({ url: MASTER_URL, headers: {} });
      const wrong = session.mediaUrl.replace(/\/g\/[0-9a-f]{32}\//, `/g/${"0".repeat(32)}/`);
      const res = await fetch(wrong);
      expect(res.status).toBe(404);
    } finally {
      gw.stop();
    }
  });

  test("media route streams the entry URL with exactly the normalized headers", async () => {
    const { calls, fetchImpl } = recordingFetch({
      "https://cdn.example.com/movie.mp4": { body: "video-bytes" },
    });
    const gw = start({ fetchImpl });
    try {
      const session = gw.registerSession({
        url: "https://cdn.example.com/movie.mp4",
        headers: { Referer: "https://embed.example/", "X-Extra": "yes" },
      });
      const res = await fetch(session.mediaUrl);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("video-bytes");
      const sent = calls[0]?.headers ?? {};
      expect(sent["referer"]).toBe("https://embed.example/");
      expect(sent["x-extra"]).toBe("yes");
    } finally {
      gw.stop();
    }
  });

  test("Range is forwarded upstream and the 206 headers come back", async () => {
    const { calls } = recordingFetch({});
    const rangeFetch = async (url: string, init: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => {
        headers[k] = v;
      });
      calls.push({ url, headers });
      return new Response("partial", {
        status: 206,
        headers: {
          "content-range": "bytes 0-99/1000",
          "accept-ranges": "bytes",
          "content-length": "100",
        },
      });
    };
    const gw = start({ fetchImpl: rangeFetch });
    try {
      const session = gw.registerSession({
        url: "https://cdn.example.com/movie.mp4",
        headers: {},
      });
      const res = await fetch(session.mediaUrl, { headers: { Range: "bytes=0-99" } });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe("bytes 0-99/1000");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(calls[0]?.headers["range"]).toBe("bytes=0-99");
    } finally {
      gw.stop();
    }
  });

  test("HLS playlist URIs rewrite to gateway paths, keys included, relatives resolved", async () => {
    const { fetchImpl } = recordingFetch({ [MASTER_URL]: { body: PLAYLIST_BODY } });
    const gw = start({ fetchImpl });
    try {
      const session = gw.registerSession({ url: MASTER_URL, headers: {} });
      const res = await fetch(session.mediaUrl);
      const text = await res.text();
      // AES key URI rewritten inside the tag.
      expect(text).toContain(`URI="${session.mediaUrl.replace(/\/media$/, "/f/")}`);
      // Relative segment resolved against the playlist URL then rewritten.
      expect(text).toContain("/g/");
      expect(text).not.toContain("\nseg-0.ts");
      // Both segment origins are now allowlisted.
      const decodedHosts = [...text.matchAll(/\/f\/([A-Za-z0-9_-]+)/g)].map((m) => {
        const b64 = (m[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
        const pad = "=".repeat((4 - (b64.length % 4)) % 4);
        return Buffer.from(b64 + pad, "base64").toString();
      });
      expect(decodedHosts).toEqual(
        expect.arrayContaining([
          expect.stringContaining("keys.example.com/k.bin"),
          expect.stringContaining("cdn.example.com/seg-0.ts"),
          expect.stringContaining("seg2.cdn.example.com/seg-1.ts"),
        ]),
      );
    } finally {
      gw.stop();
    }
  });

  test("a blocked playlist URI cannot escape to the external player", async () => {
    const evilPlaylist = [
      "#EXTM3U",
      "#EXTINF:6.0,",
      "http://169.254.169.254/latest/meta-data",
      "http://internal.svc/seg.ts",
      "#EXT-X-ENDLIST",
    ].join("\n");
    const { fetchImpl } = recordingFetch({ [MASTER_URL]: { body: evilPlaylist } });
    const gw = start({ fetchImpl });
    try {
      const session = gw.registerSession({ url: MASTER_URL, headers: {} });
      const res = await fetch(session.mediaUrl);
      const text = await res.text();
      expect(text).not.toContain("http://169.254.169.254/latest/meta-data");
      const blockedUrl = text.split("\n").find((line) => line.startsWith("http"));
      expect(blockedUrl).toStartWith(gw.baseUrl);
      expect((await fetch(blockedUrl ?? "")).status).toBe(404);
      // Crafted fetch for a never-allowlisted host refuses.
      const crafted = `${gw.baseUrl}/g/${session.mediaUrl.split("/g/")[1]?.split("/")[0]}/f/${Buffer.from("https://evil.example.com/x.ts").toString("base64url")}`;
      const refused = await fetch(crafted);
      expect(refused.status).toBe(403);
      // And a private literal refused even though it appeared in a playlist.
      const privateCrafted = `${gw.baseUrl}/g/${session.mediaUrl.split("/g/")[1]?.split("/")[0]}/f/${Buffer.from("http://169.254.169.254/x").toString("base64url")}`;
      expect((await fetch(privateCrafted)).status).toBe(403);
    } finally {
      gw.stop();
    }
  });

  test("a redirect to a private address is refused", async () => {
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url === "https://cdn.example.com/start.m3u8") {
        return new Response("", {
          status: 302,
          headers: { location: "http://10.0.0.5/seg.m3u8" },
        });
      }
      return new Response("", { status: 302, headers: { location: "http://127.0.0.1/x" } });
    };
    const gw = start({ fetchImpl });
    try {
      const session = gw.registerSession({
        url: "https://cdn.example.com/start.m3u8",
        headers: {},
      });
      const res = await fetch(session.mediaUrl);
      expect(res.status).toBe(403);
    } finally {
      gw.stop();
    }
  });

  test("the subtitle route serves a registered track", async () => {
    const { calls, fetchImpl } = recordingFetch({
      "https://subs.example.com/en.vtt": {
        body: "WEBVTT\n\n00:00.000 --> 00:01.000\nhi",
        contentType: "text/vtt",
      },
    });
    const gw = start({ fetchImpl });
    try {
      const session = gw.registerSession({
        url: "https://cdn.example.com/m.mp4",
        headers: { referer: "https://embed.example/" },
        subtitles: ["https://subs.example.com/en.vtt"],
      });
      expect(session.subtitleUrls).toHaveLength(1);
      const res = await fetch(session.subtitleUrls[0] ?? "");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("WEBVTT");
      expect(calls[0]?.headers["referer"]).toBe("https://embed.example/");
    } finally {
      gw.stop();
    }
  });

  test("idle shutdown fires from the injected clock, not a sleep", async () => {
    const scheduled: Array<() => void> = [];
    const gw = start({
      fetchImpl: async () => new Response("x"),
      timers: {
        schedule: (cb) => {
          scheduled.push(cb);
          return () => {};
        },
      },
      idleTimeoutMs: 60_000,
    });
    expect(gw.isStopped()).toBe(false);
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    expect(gw.isStopped()).toBe(true);
  });

  test("idle shutdown cannot interrupt an active progressive response", async () => {
    const scheduled: Array<() => void> = [];
    let finishBody: (() => void) | undefined;
    const gw = start({
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("video-start"));
              finishBody = () => {
                controller.enqueue(new TextEncoder().encode("video-end"));
                controller.close();
              };
            },
          }),
        ),
      timers: {
        schedule: (cb) => {
          scheduled.push(cb);
          return () => {};
        },
      },
    });
    try {
      const session = gw.registerSession({ url: "https://cdn.example.com/movie.mp4", headers: {} });
      const response = await fetch(session.mediaUrl);
      scheduled.at(-1)?.();
      expect(gw.isStopped()).toBe(false);
      finishBody?.();
      expect(await response.text()).toBe("video-startvideo-end");
      scheduled.at(-1)?.();
      expect(gw.isStopped()).toBe(true);
    } finally {
      finishBody = undefined;
      gw.stop();
    }
  });

  test("a single playlist chunk above 4 MiB is refused", async () => {
    const gw = start({
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode("#EXTM3U\n" + " ".repeat(4 * 1024 * 1024)),
              );
              controller.close();
            },
          }),
        ),
    });
    try {
      const session = gw.registerSession({ url: MASTER_URL, headers: {} });
      expect((await fetch(session.mediaUrl)).status).toBe(502);
    } finally {
      gw.stop();
    }
  });

  test("a blocked MPD BaseURL cannot escape to the external player", async () => {
    const gw = start({ fetchImpl: recordingFetch({}).fetchImpl });
    try {
      const session = gw.registerSession({
        headers: {},
        document: {
          text: "<MPD><BaseURL>http://127.0.0.1/private.mp4</BaseURL></MPD>",
          contentType: "application/dash+xml",
          remoteUrls: [],
        },
      });
      const text = await (await fetch(session.mediaUrl)).text();
      expect(text).not.toContain("http://127.0.0.1/private.mp4");
      const blockedUrl = text.match(/<BaseURL>([^<]+)<\/BaseURL>/)?.[1];
      expect(blockedUrl).toStartWith(gw.baseUrl);
      expect((await fetch(blockedUrl ?? "")).status).toBe(404);
    } finally {
      gw.stop();
    }
  });

  test("a 10 MiB progressive MP4 streams fully on /media with no buffering cap", async () => {
    const big = crypto.getRandomValues(new Uint8Array(10 * 1024 * 1024));
    const gw = start({
      fetchImpl: async () => new Response(new Uint8Array(big), { status: 200 }),
    });
    try {
      const session = gw.registerSession({
        url: "https://cdn.example.com/movie.mp4",
        headers: {},
      });
      const res = await fetch(session.mediaUrl);
      expect(res.status).toBe(200);
      const received = new Uint8Array(await res.arrayBuffer());
      expect(received.byteLength).toBe(big.byteLength);
      expect(Buffer.from(received).equals(Buffer.from(big))).toBe(true);
    } finally {
      gw.stop();
    }
  });

  test("an octet-stream HLS playlist at a non-.m3u8 URL is still rewritten", async () => {
    const sneaky = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXTINF:6.0,",
      "https://seg.example.com/a.ts",
      "#EXT-X-ENDLIST",
    ].join("\n");
    const gw = start({
      fetchImpl: async () =>
        new Response(sneaky, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    });
    try {
      const session = gw.registerSession({
        url: "https://cdn.example.com/load?id=1", // no .m3u8, generic content-type
        headers: {},
      });
      const res = await fetch(session.mediaUrl);
      const text = await res.text();
      expect(text).toContain("/f/");
      expect(text).not.toContain("https://seg.example.com/a.ts");
      // And the rewritten segment actually fetches through the gateway.
      const segUrl = text.match(/https?:\/\/[^\s]+/u)?.[0];
      expect(segUrl).toBeDefined();
      const segRes = await fetch(segUrl ?? "");
      expect([403, 404, 502, 200]).toContain(segRes.status); // fetched, not bypassed
    } finally {
      gw.stop();
    }
  });

  test("a BOM-prefixed playlist is detected and rewritten", async () => {
    const gw = start({
      fetchImpl: async () =>
        new Response("\uFEFF#EXTM3U\n#EXT-X-ENDLIST\n", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    });
    try {
      const session = gw.registerSession({
        url: "https://cdn.example.com/play",
        headers: {},
      });
      const res = await fetch(session.mediaUrl);
      expect(res.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    } finally {
      gw.stop();
    }
  });

  test("a body whose first chunk is binary passes through byte-identical", async () => {
    const binary = crypto.getRandomValues(new Uint8Array(2 * 1024 * 1024));
    const gw = start({
      fetchImpl: async () =>
        new Response(binary, {
          status: 206,
          headers: {
            "content-range": "bytes 0-2097151/2097151",
            "accept-ranges": "bytes",
          },
        }),
    });
    try {
      const session = gw.registerSession({
        url: "https://cdn.example.com/chunk.ts",
        headers: {},
      });
      const res = await fetch(session.mediaUrl, { headers: { Range: "bytes=0-" } });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe("bytes 0-2097151/2097151");
      const received = Buffer.from(await res.arrayBuffer());
      expect(received.equals(Buffer.from(binary))).toBe(true);
    } finally {
      gw.stop();
    }
  });

  test("a second registration revokes the first token", async () => {
    const { fetchImpl } = recordingFetch({
      "https://cdn.example.com/a.mp4": { body: "a" },
      "https://cdn.example.com/b.mp4": { body: "b" },
    });
    const gw = start({ fetchImpl });
    try {
      const first = gw.registerSession({ url: "https://cdn.example.com/a.mp4", headers: {} });
      gw.registerSession({ url: "https://cdn.example.com/b.mp4", headers: {} });
      const res = await fetch(first.mediaUrl);
      expect(res.status).toBe(404);
    } finally {
      gw.stop();
    }
  });

  test("a document session serves a rewritten MPD at /doc", async () => {
    const mpd = `<?xml version="1.0"?><MPD><Period><AdaptationSet><Representation><BaseURL>https://seg.example.com/v.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`;
    const { fetchImpl } = recordingFetch({});
    const gw = start({ fetchImpl });
    try {
      const session = gw.registerSession({
        headers: {},
        document: {
          text: mpd,
          contentType: "application/dash+xml",
          remoteUrls: ["https://seg.example.com/v.mp4"],
        },
      });
      expect(session.mediaUrl).toContain("/doc");
      const res = await fetch(session.mediaUrl);
      const text = await res.text();
      expect(text).toContain(`/g/`);
      expect(text).not.toContain("seg.example.com/v.mp4");
    } finally {
      gw.stop();
    }
  });
});
