import { expect, test } from "bun:test";

import { createStreamGateway } from "@/infra/player/stream-gateway";

test("companion gateway authorizes its exact browser origin for media and subtitle CORS", async () => {
  const browserOrigin = "http://127.0.0.1:4141";
  const gateway = createStreamGateway({
    browserOrigin,
    fetchImpl: async () => new Response("WEBVTT\n\n", { headers: { "content-type": "text/vtt" } }),
  });
  try {
    const session = gateway.registerSession({
      url: "https://cdn.example.test/movie.mp4",
      headers: {},
      subtitles: ["https://cdn.example.test/sub.vtt"],
    });
    for (const url of [session.mediaUrl, ...session.subtitleUrls]) {
      const response = await fetch(url, { headers: { Origin: browserOrigin } });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(browserOrigin);
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
      await response.text();
      expect(
        (await fetch(url, { headers: { Origin: "https://foreign.example.test" } })).status,
      ).toBe(403);
    }
    session.stop();
    expect((await fetch(session.mediaUrl, { headers: { Origin: browserOrigin } })).status).toBe(
      404,
    );
  } finally {
    gateway.stop();
  }
});

test("companion CORS cannot be configured for a remote or wildcard origin", () => {
  for (const browserOrigin of [
    "*",
    "https://example.test",
    "http://localhost:4141",
    "http://127.0.0.1:4141/path",
  ]) {
    expect(() => createStreamGateway({ browserOrigin })).toThrow();
  }
});

test.each([
  {
    name: "WebVTT",
    body: "\uFEFFWEBVTT\r\n\r\n00:00.000 --> 00:01.000\r\nHello\r\n",
    expected: "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n",
  },
  {
    name: "SRT",
    body: "1\r\n00:00:00,000 --> 00:00:01,000\r\nHello\r\n",
    expected: "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nHello\n",
  },
])(
  "browser $name tracks arrive as WebVTT while native tracks retain their format",
  async ({ body, expected }) => {
    for (const browserOrigin of [undefined, "http://127.0.0.1:4141"]) {
      const gateway = createStreamGateway({
        browserOrigin,
        fetchImpl: async () =>
          new Response(body, { headers: { "content-type": "application/octet-stream" } }),
      });
      try {
        const session = gateway.registerSession({
          url: "https://cdn.example.test/movie.mp4",
          headers: {},
          subtitles: ["https://cdn.example.test/captions"],
        });
        const response = await fetch(session.subtitleUrls[0]!);
        expect(response.status).toBe(200);
        if (browserOrigin)
          expect(response.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
        if (browserOrigin) expect(await response.text()).toBe(expected);
        else
          expect(new Uint8Array(await response.arrayBuffer())).toEqual(
            new TextEncoder().encode(body),
          );
      } finally {
        gateway.stop();
      }
    }
  },
);

test.each([
  "[Script Info]\nTitle: ASS\n[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello",
  "<html>upstream error</html>",
  "WEBVTTgarbage\n",
  "\u0000\u0001",
  "x".repeat(1024 * 1024 + 1),
])("browser refuses unsupported or oversized tracks without claiming attachment", async (body) => {
  const gateway = createStreamGateway({
    browserOrigin: "http://127.0.0.1:4141",
    fetchImpl: async () => new Response(body),
  });
  try {
    const session = gateway.registerSession({
      url: "https://cdn.example.test/movie.mp4",
      headers: {},
      subtitles: ["https://cdn.example.test/captions"],
    });
    const response = await fetch(session.subtitleUrls[0]!);
    expect(response.status).toBe(422);
    expect(await response.text()).toBe("unsupported browser subtitle");
  } finally {
    gateway.stop();
  }
});
