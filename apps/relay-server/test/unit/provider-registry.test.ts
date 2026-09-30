import { expect, test } from "bun:test";

import { PRODUCTION_PROVIDER_MODULES } from "@kunai/providers/production-modules";

import { relayRegistry } from "../../src/provider-registry";

/**
 * The registry is `buildProviderRelayRegistry(PRODUCTION_PROVIDER_MODULES)` —
 * this test exists to catch a future edit that goes back to picking providers
 * by hand. The deployment used to know six of twelve production providers, so
 * the CLI's relay-routed requests answered `unknown-provider` and one stale
 * relay took down the whole anime lane.
 */
test("the registry covers every production module that declares relayProfile", () => {
  const expected = PRODUCTION_PROVIDER_MODULES.filter(
    (module) => module.manifest.relayProfile !== undefined,
  )
    .map((module) => module.providerId)
    .sort();

  expect(relayRegistry.providers.map((entry) => entry.providerId).sort()).toEqual(expected);
  // youtube declares no relayProfile — it must stay out even though it is a
  // production module.
  expect(expected).not.toContain("youtube");
});

test("every registered provider is reachable through registry.get", () => {
  for (const entry of relayRegistry.providers) {
    expect(relayRegistry.get(entry.providerId)).toBe(entry);
  }
});
