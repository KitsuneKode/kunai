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
