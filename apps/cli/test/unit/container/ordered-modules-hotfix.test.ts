import { describe, expect, test } from "bun:test";

import { createOrderedModulesGetter } from "@/container/bootstrap-providers";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import type { ConfigStore } from "@/services/persistence/ConfigStore";
import { defineProviderManifest, type CoreProviderModule } from "@kunai/core";
import type { ProviderHotfixManifest } from "@kunai/providers";

class MemoryConfigStore implements ConfigStore {
  constructor(private loaded: Partial<KitsuneConfig> = {}) {}
  async load(): Promise<Partial<KitsuneConfig>> {
    return this.loaded;
  }
  async save(config: KitsuneConfig): Promise<void> {
    this.loaded = config;
  }
  async reset(): Promise<void> {
    this.loaded = {};
  }
}

function createModule(id: string, mediaKinds: readonly ("anime" | "movie" | "series")[]) {
  return {
    providerId: id,
    manifest: defineProviderManifest({
      id,
      displayName: id,
      description: id,
      domain: `${id}.example`,
      recommended: true,
      mediaKinds,
      capabilities: ["source-resolve"],
      runtimePorts: [],
      cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: ["provider"] },
      browserSafe: true,
      relaySafe: true,
    }),
    async resolve() {
      throw new Error("resolve should not be called");
    },
  } satisfies CoreProviderModule;
}

const MODULES = [
  createModule("s1", ["movie", "series"]),
  createModule("s2", ["movie", "series"]),
  createModule("s3", ["movie", "series"]),
];

const MANIFEST: ProviderHotfixManifest = {
  schemaVersion: 1,
  revision: 3,
  generatedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z",
  lanePriorities: { series: ["s3"] },
  providers: { s2: { disabled: true } },
};

describe("playback module admission follows the active hotfix manifest", () => {
  test("a manifest-disabled provider leaves the resolver's list; lane priority reorders it", async () => {
    const config = await ConfigServiceImpl.load(
      new MemoryConfigStore({ provider: "s1", providerPriority: ["s1", "s2", "s3"] }),
    );
    let manifest: ProviderHotfixManifest | null = null;
    const getOrdered = createOrderedModulesGetter(config, MODULES, () => manifest);

    expect(getOrdered().map((module) => module.providerId)).toEqual(["s1", "s2", "s3"]);

    manifest = MANIFEST;
    const ids = getOrdered().map((module) => module.providerId);
    expect(ids).not.toContain("s2");
    // User lead stays first; the manifest's lane order comes next.
    expect(ids).toEqual(["s1", "s3"]);

    // Expiry: the getter reads the (expiry-aware) manifest every call, so once
    // it reports nothing the provider is admitted again without a rewrite.
    manifest = null;
    expect(getOrdered().map((module) => module.providerId)).toEqual(["s1", "s2", "s3"]);
  });

  test("the user's own disables still apply alongside the manifest", async () => {
    const config = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        provider: "s1",
        providerPriority: ["s1", "s2", "s3"],
        disabledProviders: ["s3"],
      }),
    );
    const getOrdered = createOrderedModulesGetter(config, MODULES, () => MANIFEST);
    expect(getOrdered().map((module) => module.providerId)).toEqual(["s1"]);
  });
});

describe("stremio addon opt-in admission", () => {
  test("an addon leaves the resolve roster the moment consent is off — and rejoins on enable", async () => {
    const { isStremioAddonProviderId } = await import("@kunai/providers");
    const { stremioAddonsEnabled } = await import("@/domain/provider/stremio-addons");
    const addon = createModule("stremio-addon-fixture-abc12345", ["movie", "series"]);
    const modules = [...MODULES, addon];
    const config = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        experimentalStremioAddons: true,
        stremioAddonsRiskAcknowledgedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const isEnabled = () =>
      stremioAddonsEnabled(config.readStremioAddonsConsent?.() ?? config.getRaw());
    const getOrdered = createOrderedModulesGetter(
      config,
      modules,
      () => null,
      (module) => !isStremioAddonProviderId(module.providerId) || isEnabled(),
    );

    expect(getOrdered().map((module) => module.providerId)).toContain(addon.providerId);

    // A standalone `kunai addons disable` — patched through the same config —
    // empties the roster's addon seat at the next call, without a restart.
    await config.update({ experimentalStremioAddons: false });
    expect(getOrdered().map((module) => module.providerId)).toEqual(["s1", "s2", "s3"]);

    await config.update({ experimentalStremioAddons: true });
    expect(getOrdered().map((module) => module.providerId)).toContain(addon.providerId);
  });

  test("a flag without a stored acknowledgement never admits the addon", async () => {
    const { isStremioAddonProviderId } = await import("@kunai/providers");
    const { stremioAddonsEnabled } = await import("@/domain/provider/stremio-addons");
    const addon = createModule("stremio-addon-fixture-abc12345", ["movie", "series"]);
    const config = await ConfigServiceImpl.load(
      new MemoryConfigStore({ experimentalStremioAddons: true }),
    );
    const getOrdered = createOrderedModulesGetter(
      config,
      [...MODULES, addon],
      () => null,
      (module) =>
        !isStremioAddonProviderId(module.providerId) ||
        stremioAddonsEnabled(config.readStremioAddonsConsent?.() ?? config.getRaw()),
    );

    expect(getOrdered().map((module) => module.providerId)).toEqual(["s1", "s2", "s3"]);
  });
});

describe("production roster construction", () => {
  test("loadConfiguredProviderModules registers no addon while off — even with a valid install", async () => {
    const { isStremioAddonProviderId } = await import("@kunai/providers");
    const { loadConfiguredProviderModules } = await import("@/container/bootstrap-providers");
    const { createProviderPrioritySnapshot } =
      await import("@/services/providers/provider-priority");
    const config = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        stremioAddons: [{ url: "https://b.example.com/manifest.json" }],
      }),
    );

    const modules = await loadConfiguredProviderModules(
      config,
      createProviderPrioritySnapshot(config.getRaw()),
    );

    // The addon entry is installed and well-formed; consent is simply absent.
    expect(config.stremioAddons).toHaveLength(1);
    expect(modules.some((module) => isStremioAddonProviderId(module.providerId))).toBe(false);
    expect(modules.length).toBeGreaterThan(0);
  });

  test("loadConfiguredProviderModules includes the addon once enabled — and its gate tracks consent", async () => {
    const { isStremioAddonProviderId } = await import("@kunai/providers");
    const { loadConfiguredProviderModules } = await import("@/container/bootstrap-providers");
    const { createProviderPrioritySnapshot } =
      await import("@/services/providers/provider-priority");
    const config = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        stremioAddons: [{ url: "https://b.example.com/manifest.json" }],
        experimentalStremioAddons: true,
        stremioAddonsRiskAcknowledgedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const modules = await loadConfiguredProviderModules(
      config,
      createProviderPrioritySnapshot(config.getRaw()),
    );

    expect(modules.some((module) => isStremioAddonProviderId(module.providerId))).toBe(true);
  });
});
