import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import {
  clearTmdbSessionCache,
  setTmdbDurableCache,
  setTmdbUserKeySource,
} from "@/services/catalog/tmdb-proxy";
import { createProviderPrioritySnapshot } from "@/services/providers/provider-priority";
import {
  createStremioAddonModules,
  resolveImdbIdFromTmdb,
} from "@/services/providers/stremio-addon-modules";
import { DEFAULT_CONFIG, type StremioAddonConfigEntry } from "@kunai/config";
import { resolveProviderLaneFromModule } from "@kunai/core";
import type { LooseJsonValue } from "@kunai/types";

const A = "https://a.example.com/SECRETTOKEN/manifest.json";
const B = "https://b.example.com/manifest.json";

describe("addon provider modules", () => {
  test("one module per installed addon, named by the addon and never by its path", () => {
    const entries: StremioAddonConfigEntry[] = [{ url: A, name: "Alpha" }, { url: B }];

    const modules = createStremioAddonModules({ getEntries: () => entries });

    expect(modules.map((module) => module.manifest.displayName)).toEqual([
      "Alpha",
      "b.example.com",
    ]);
    expect(modules.every((module) => module.providerId.startsWith("stremio-"))).toBe(true);
    expect(JSON.stringify(modules.map((module) => module.manifest))).not.toContain("SECRETTOKEN");
  });

  test("an invalid stored entry produces no module", () => {
    const modules = createStremioAddonModules({
      getEntries: () => [{ url: "http://plain.example.com/manifest.json" }, { url: B }],
    });

    expect(modules).toHaveLength(1);
  });

  test("an addon removed after startup is not asked again", async () => {
    let entries: StremioAddonConfigEntry[] = [{ url: B }];
    const requested: string[] = [];
    const [module] = createStremioAddonModules({
      getEntries: () => entries,
      resolveImdbId: async () => "tt1375666",
    });
    if (!module) throw new Error("expected one addon module");
    entries = [];

    const result = await module.resolve(
      {
        mediaKind: "movie",
        intent: "play",
        title: { id: "tmdb:27205", kind: "movie", title: "Inception" },
        allowedRuntimes: ["direct-http"],
      },
      {
        now: () => new Date().toISOString(),
        fetch: {
          runtime: "direct-http",
          fetch: async (input) => {
            requested.push(String(input));
            return new Response("{}");
          },
        },
      },
    );

    expect(result.status).toBe("exhausted");
    expect(requested).toEqual([]);
  });
});

describe("addons in the production roster", () => {
  test("addons join the movies and series lane after every bundled provider", async () => {
    const priority = createProviderPrioritySnapshot(DEFAULT_CONFIG);
    const bundled = await loadProductionProviderModules(priority);
    const addons = createStremioAddonModules({ getEntries: () => [{ url: A }, { url: B }] });

    const modules = await loadProductionProviderModules(priority, addons);
    const seriesLane = modules.filter(
      (module) => resolveProviderLaneFromModule(module) === "series",
    );
    const bundledSeries = bundled.filter(
      (module) => resolveProviderLaneFromModule(module) === "series",
    );

    expect(modules).toHaveLength(bundled.length + 2);
    expect(seriesLane.slice(0, bundledSeries.length).map((module) => module.providerId)).toEqual(
      bundledSeries.map((module) => module.providerId),
    );
    expect(seriesLane.slice(bundledSeries.length).map((module) => module.providerId)).toEqual(
      addons.map((module) => module.providerId),
    );
  });

  test("an addon the user placed first in their order is tried first", async () => {
    const addons = createStremioAddonModules({ getEntries: () => [{ url: B }] });
    const addonId = addons[0]?.providerId ?? "";

    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot({
        ...DEFAULT_CONFIG,
        provider: addonId,
        providerPriority: [addonId, ...DEFAULT_CONFIG.providerPriority],
      }),
      addons,
    );

    expect(
      modules.find((module) => resolveProviderLaneFromModule(module) === "series")?.providerId,
    ).toBe(addonId);
  });

  test("with no addons installed the roster is exactly the bundled one", async () => {
    const priority = createProviderPrioritySnapshot(DEFAULT_CONFIG);

    expect(
      (await loadProductionProviderModules(priority, [])).map((module) => module.providerId),
    ).toEqual((await loadProductionProviderModules(priority)).map((module) => module.providerId));
  });
});

describe("IMDb id for a TMDB title", () => {
  const originalFetch = globalThis.fetch;
  let originalEnvKey: string | undefined;
  const serve = (respond: (url: string) => Response): string[] => {
    const seen: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request): Promise<Response> => {
        const url = String(input);
        seen.push(url);
        return respond(url);
      },
      { preconnect: originalFetch.preconnect },
    );
    return seen;
  };
  const json = (body: LooseJsonValue, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  beforeEach(() => {
    originalEnvKey = process.env.KUNAI_TMDB_API_KEY;
    delete process.env.KUNAI_TMDB_API_KEY;
    setTmdbDurableCache(null);
    clearTmdbSessionCache();
  });

  afterEach(() => {
    if (originalEnvKey === undefined) delete process.env.KUNAI_TMDB_API_KEY;
    else process.env.KUNAI_TMDB_API_KEY = originalEnvKey;
    globalThis.fetch = originalFetch;
    setTmdbUserKeySource(null);
    clearTmdbSessionCache();
  });

  test("reads the id from TMDB's own external_ids record", async () => {
    const seen = serve(() => json({ id: 27205, imdb_id: "tt1375666" }));

    const movie = await resolveImdbIdFromTmdb({ tmdbId: 27205, mediaKind: "movie" });
    const series = await resolveImdbIdFromTmdb({ tmdbId: 1399, mediaKind: "series" });

    expect(movie).toBe("tt1375666");
    expect(series).toBe("tt1375666");
    expect(seen.some((url) => url.includes("/movie/27205/external_ids"))).toBe(true);
    expect(seen.some((url) => url.includes("/tv/1399/external_ids"))).toBe(true);
  });

  test("a title with no IMDb id, or a value that is not one, is null", async () => {
    serve((url) =>
      url.includes("/movie/1/") ? json({ imdb_id: null }) : json({ imdb_id: "Inception" }),
    );

    expect(await resolveImdbIdFromTmdb({ tmdbId: 1, mediaKind: "movie" })).toBeNull();
    expect(await resolveImdbIdFromTmdb({ tmdbId: 2, mediaKind: "movie" })).toBeNull();
  });

  test("an id TMDB does not know is null; a catalog that cannot be asked rejects", async () => {
    serve(() => json({ status_message: "not found" }, 404));
    expect(await resolveImdbIdFromTmdb({ tmdbId: 3, mediaKind: "movie" })).toBeNull();

    clearTmdbSessionCache();
    serve(() => {
      throw new Error("connect ECONNREFUSED");
    });
    await expect(resolveImdbIdFromTmdb({ tmdbId: 4, mediaKind: "movie" })).rejects.toThrow();
  });
});
