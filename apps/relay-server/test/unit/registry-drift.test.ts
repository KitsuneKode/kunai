import { expect, test } from "bun:test";

import { classifyRelayDriftResponse, type RelayDriftProbe } from "../../src/registry-drift";

const probe: RelayDriftProbe = { providerId: "anidb", url: "https://anidb.app/" };

test("a relay that does not know the provider is drift", () => {
  expect(
    classifyRelayDriftResponse(
      probe,
      JSON.stringify({ error: { code: "unknown-provider", providerId: "anidb" } }),
    ),
  ).toContain("provider missing from deployment");
});

test("a stale host allowlist is drift", () => {
  expect(
    classifyRelayDriftResponse(
      probe,
      JSON.stringify({ error: { code: "host-not-allowed", providerId: "anidb" } }),
    ),
  ).toContain("rejects anidb.app");
});

/**
 * anidb.app and www.miruro.bz sit behind Cloudflare, so probing them from a
 * datacentre IP answers 403 with a challenge page. That is the upstream
 * refusing the relay, not the relay missing the provider — reading the bare
 * status as drift reported a correctly deployed relay as stale.
 */
test("an upstream Cloudflare challenge is not drift", () => {
  const challenge = '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>';

  expect(classifyRelayDriftResponse(probe, challenge)).toBeNull();
});

test("a healthy upstream answer is not drift", () => {
  expect(classifyRelayDriftResponse(probe, JSON.stringify({ status: 200, result: {} }))).toBeNull();
});
