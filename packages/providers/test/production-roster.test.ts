import { describe, expect, test } from "bun:test";

import { orderProviderModulesByPriority } from "@kunai/core";

import { PRODUCTION_PROVIDER_IDS, PRODUCTION_PROVIDER_LOADERS } from "../src/production";
import { PRODUCTION_PROVIDER_MODULES } from "../src/production-modules";

/**
 * The production roster exists twice — lazy loaders for the CLI bootstrap and
 * a static array for the relay server and the status sweep. Two hand-kept
 * lists is how the relay shipped six providers while the CLI ran twelve, so
 * this file pins them to the same ids.
 */
describe("production provider roster", () => {
  test("the eager modules and the lazy loaders name the same providers", () => {
    expect(PRODUCTION_PROVIDER_MODULES.map((module) => module.providerId).sort()).toEqual(
      Object.keys(PRODUCTION_PROVIDER_LOADERS).sort(),
    );
  });

  test("PRODUCTION_PROVIDER_IDS is the loader map's keys", () => {
    expect<string[]>([...PRODUCTION_PROVIDER_IDS].sort()).toEqual(
      Object.keys(PRODUCTION_PROVIDER_LOADERS).sort(),
    );
  });

  test("every loader resolves the module its key names", async () => {
    for (const [providerId, load] of Object.entries(PRODUCTION_PROVIDER_LOADERS)) {
      const module = await load();
      expect(module.providerId).toBe(providerId);
      expect(module.manifest.id).toBe(providerId);
    }
  });

  test("every module carries a manifest", () => {
    for (const module of PRODUCTION_PROVIDER_MODULES) {
      expect(module.providerId.length).toBeGreaterThan(0);
      expect(module.manifest.id).toBe(module.providerId);
    }
  });

  test("priority ordering still works over the eager roster", () => {
    const ordered = orderProviderModulesByPriority(PRODUCTION_PROVIDER_MODULES, {
      providerPriority: ["movy"],
      animeProviderPriority: ["kickassanime"],
      youtubeProviderPriority: [],
    });

    // Lane slots keep their input positions; within a lane the ranked id moves
    // to that lane's first slot.
    expect(ordered[0]?.providerId).toBe("movy");
    expect(ordered[5]?.providerId).toBe("kickassanime");
    expect(ordered.at(-1)?.providerId).toBe("youtube");
  });
});
