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
