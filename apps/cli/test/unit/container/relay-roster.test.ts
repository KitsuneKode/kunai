import { expect, test } from "bun:test";

import { loadProductionProviderModules } from "@/container/bootstrap-providers";

import { relayRegistry } from "../../../../relay-server/src/provider-registry";

// Production is the bootstrap roster, not every provider directory. Comparing
// only registry-derived probes cannot detect a provider missing from that registry.
test("the relay registry covers exactly the relayable production roster", async () => {
  const modules = await loadProductionProviderModules({
    providerPriority: [],
    animeProviderPriority: [],
  });
  const relayable = modules
    .filter((module) => module.manifest.relayProfile !== undefined)
    .map((module) => String(module.providerId))
    .sort();
  expect(relayable).toHaveLength(10);
  expect(relayRegistry.providers.map((entry) => entry.providerId).sort()).toEqual(relayable);
});
