import { expect, test } from "bun:test";

import { buildProviderRelayRegistry } from "../src/registry";
import { rewriteStreamUrlForRelay } from "../src/rewrite-stream-url";

const registry = buildProviderRelayRegistry([
  {
    providerId: "allanime",
    manifest: {
      relayProfile: {
        upstreamHosts: ["api.allanime.day"],
        videoRelayHosts: ["fast4speed.rsvp"],
      },
    },
  },
] as never);

test("rewriteStreamUrlForRelay leaves stream URLs direct by default", () => {
  expect(
    rewriteStreamUrlForRelay({
      url: "https://fast4speed.rsvp/video.mp4",
      providerId: "allanime",
      relayConfig: { baseUrl: "https://relay.example" },
      registry,
    }),
  ).toBe("https://fast4speed.rsvp/video.mp4");
});

test("rewriteStreamUrlForRelay rewrites only opted-in allowlisted media hosts", () => {
  const rewritten = rewriteStreamUrlForRelay({
    url: "https://fast4speed.rsvp/video.mp4?token=a=b",
    providerId: "allanime",
    relayConfig: {
      baseUrl: "https://relay.example",
      providers: {
        allanime: { videoFallback: true },
      },
    },
    registry,
  });

  expect(rewritten).toBe(
    "https://relay.example/stream/allanime?u=https%3A%2F%2Ffast4speed.rsvp%2Fvideo.mp4%3Ftoken%3Da%3Db",
  );
});

test("rewriteStreamUrlForRelay rejects non-media hosts", () => {
  expect(
    rewriteStreamUrlForRelay({
      url: "https://evil.example/video.mp4",
      providerId: "allanime",
      relayConfig: {
        baseUrl: "https://relay.example",
        providers: { allanime: { videoFallback: true } },
      },
      registry,
    }),
  ).toBe("https://evil.example/video.mp4");
});
