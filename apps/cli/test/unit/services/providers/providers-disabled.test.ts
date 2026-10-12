import { describe, expect, test } from "bun:test";

import { isProviderEnabled } from "@/services/providers/provider-priority";
import { ProviderRegistryImpl } from "@/services/providers/ProviderRegistry";
import { createProviderEngine, defineProviderManifest, type CoreProviderModule } from "@kunai/core";

function createModule(id: string, mediaKinds: readonly ("anime" | "movie" | "series" | "video")[]) {
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

function createRegistry(disabledProviderIds?: readonly string[]) {
  const modules = [
    createModule("s1", ["movie", "series"]),
    createModule("s2", ["movie", "series"]),
    createModule("a1", ["anime"]),
    createModule("a2", ["anime"]),
    createModule("y1", ["video"]),
  ];
  const engine = createProviderEngine({ modules });
  const registry = new ProviderRegistryImpl(engine, {
    providerPriority: ["s1", "s2"],
    animeProviderPriority: ["a1", "a2"],
    youtubeProviderPriority: ["y1"],
    disabledProviderIds,
  });
  return registry;
}

const MOVIE_TITLE = { id: "movie:1", type: "movie", name: "Movie" } as const;
const ANIME_TITLE = { id: "anime:1", type: "series", name: "Anime" } as const;

describe("provider disable switches", () => {
  test("disabled ids leave getAll and getCompatible, enabled ids stay", () => {
    const registry = createRegistry(["s2", "A1"]);
    expect(
      registry
        .getAll()
        .map((provider) => provider.metadata.id)
        .sort(),
    ).toEqual(["a2", "s1", "y1"]);
    expect(registry.getCompatible(MOVIE_TITLE, "series").map((p) => p.metadata.id)).toEqual(["s1"]);
    expect(registry.getCompatible(ANIME_TITLE, "anime").map((p) => p.metadata.id)).toEqual(["a2"]);
  });

  test("a disabled lane default falls through to the next enabled provider", () => {
    const registry = createRegistry(["s1"]);
    expect(registry.getDefaultForMode("series").metadata.id).toBe("s2");
  });

  test("disabling a whole lane fails open instead of stranding the mode", () => {
    const registry = createRegistry(["a1", "a2"]);
    expect(
      registry
        .getCompatible(ANIME_TITLE, "anime")
        .map((p) => p.metadata.id)
        .sort(),
    ).toEqual(["a1", "a2"]);
    expect(registry.getDefaultForMode("anime").metadata.id).toBe("a1");
  });

  test("matching ignores case and surrounding whitespace", () => {
    const registry = createRegistry(["  S1 "]);
    expect(registry.getAll().map((provider) => provider.metadata.id)).not.toContain("s1");
  });

  test("setPriority refreshes the disabled set", () => {
    const registry = createRegistry();
    expect(registry.getAll().map((p) => p.metadata.id)).toContain("s2");
    registry.setPriority({ disabledProviderIds: ["s2"] });
    expect(registry.getAll().map((p) => p.metadata.id)).not.toContain("s2");
    registry.setPriority({ disabledProviderIds: [] });
    expect(registry.getAll().map((p) => p.metadata.id)).toContain("s2");
  });

  test("isProviderEnabled treats missing and empty lists as all-enabled", () => {
    expect(isProviderEnabled(undefined, "s1")).toBe(true);
    expect(isProviderEnabled([], "s1")).toBe(true);
    expect(isProviderEnabled(["s1"], "S1")).toBe(false);
    expect(isProviderEnabled(["s1"], "s2")).toBe(true);
  });
});
