import { expect, test } from "bun:test";

import { applySettingsToRuntime } from "@/app/bootstrap/apply-settings-to-runtime";
import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { ProviderRegistryImpl } from "@/services/providers/ProviderRegistry";
import { createProviderEngine, defineProviderManifest } from "@kunai/core";

test("saved provider switches immediately fence and restore retained catalog handles", async () => {
  let contacts = 0;
  const module = {
    providerId: "switch-test",
    manifest: defineProviderManifest({
      id: "switch-test",
      displayName: "Switch test",
      description: "Fixture",
      recommended: false,
      domain: "example.test",
      mediaKinds: ["movie"],
      capabilities: ["search", "source-resolve"],
      runtimePorts: [],
      cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: ["provider"] },
      browserSafe: true,
      relaySafe: false,
    }),
    async search() {
      contacts++;
      return [];
    },
    async resolve() {
      throw new Error("not resolving");
    },
  };
  const registry = new ProviderRegistryImpl(createProviderEngine({ modules: [module] }));
  const config = await ConfigServiceImpl.load({
    load: async () => ({}),
    save: async (_config: KitsuneConfig) => {},
    reset: async () => {},
  });
  const container = {
    config,
    providerRegistry: registry,
    stateManager: { getState: () => ({ mode: "series" }), dispatch: () => {} },
  } as unknown as Container;
  const retained = registry.get("switch-test")!;
  await applySettingsToRuntime({
    container,
    next: { ...config.getRaw(), disabledProviders: ["switch-test"] },
  });
  expect(
    await retained.search!("fixture", { audioPreference: "en", subtitlePreference: "en" }),
  ).toBeNull();
  expect(contacts).toBe(0);
  expect(registry.getAll()).toHaveLength(0);
  expect(registry.getAllRegistered()).toHaveLength(1);
  await applySettingsToRuntime({ container, next: { ...config.getRaw(), disabledProviders: [] } });
  await retained.search!("fixture", { audioPreference: "en", subtitlePreference: "en" });
  expect(contacts).toBe(1);
  expect(registry.getAll()).toHaveLength(1);
});
