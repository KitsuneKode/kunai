import { expect, test } from "bun:test";

import { buildProviderRelayRegistry } from "../src/registry";

const registry = buildProviderRelayRegistry([
  {
    providerId: "allanime",
    manifest: {
      relayProfile: {
        upstreamHosts: ["api.allanime.day", "allanime.day"],
      },
    },
  },
] as never);

test("registry finds providers by exact and subdomain upstream hosts", () => {
  expect(registry.findByUpstreamUrl("https://api.allanime.day/api")?.providerId).toBe("allanime");
  expect(registry.findByUpstreamUrl("https://cdn.api.allanime.day/api")?.providerId).toBe(
    "allanime",
  );
});

test("registry allows only provider metadata hosts", () => {
  expect(registry.isHostAllowed("allanime", "https://allanime.day/path", "metadata")).toBe(true);
  expect(registry.isHostAllowed("allanime", "https://fast4speed.rsvp/video.mp4", "metadata")).toBe(
    false,
  );
});

test("registry rejects hosts owned by another provider", () => {
  expect(registry.isHostAllowed("allanime", "https://miruro.bz/api", "metadata")).toBe(false);
});
