import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { parseStremioAddonUrl } from "../src/stremio-addon/addon-url";
import {
  createStremioAddonProviderModule,
  type StremioImdbIdResolver,
} from "../src/stremio-addon/module";

const TOKEN = "SECRETTOKEN";
const MANIFEST_URL = `https://addon.example.com/${TOKEN}/manifest.json`;

function addonRef() {
  const result = parseStremioAddonUrl(MANIFEST_URL);
  if (!result.ok) throw new Error(result.reason);
  return result.addon;
}

const MANIFEST = {
  id: "org.example",
  name: "Example",
  version: "1.0.0",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

interface Harness {
  readonly context: ProviderRuntimeContext;
  readonly requested: string[];
  readonly probedHeaders: Record<string, string>[];
  readonly cache: Map<string, unknown>;
}

/**
 * `streams` answers the stream resource; every other non-manifest URL is a
 * media probe, answered by `media` (default: reachable).
 */
function harness(options: {
  readonly manifest?: unknown;
  readonly streams?: unknown;
  readonly media?: (url: string) => Response;
  readonly signal?: AbortSignal;
}): Harness {
  const requested: string[] = [];
  const probedHeaders: Record<string, string>[] = [];
  const cache = new Map<string, unknown>();
  const context: ProviderRuntimeContext = {
    now: () => new Date().toISOString(),
    signal: options.signal,
    cache: {
      read: async <T>(namespace: string, key: string) =>
        (cache.get(`${namespace}|${key}`) as T | undefined) ?? null,
      write: async (namespace, key, value) => {
        cache.set(`${namespace}|${key}`, value);
      },
    },
    fetch: {
      runtime: "direct-http",
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        requested.push(url);
        if (url === MANIFEST_URL) return json(options.manifest ?? MANIFEST);
        if (url.startsWith("https://addon.example.com/")) {
          return json(options.streams ?? { streams: [] });
        }
        probedHeaders.push(Object.fromEntries(new Headers(init?.headers).entries()));
        return options.media?.(url) ?? new Response("ok");
      },
    },
  };
  return { context, requested, probedHeaders, cache };
}

function movieInput(overrides: Partial<ProviderResolveInput> = {}): ProviderResolveInput {
  return {
    mediaKind: "movie",
    intent: "play",
    title: {
      id: "tmdb:27205",
      kind: "movie",
      title: "Inception",
      externalIds: { tmdbId: "27205" },
    },
    allowedRuntimes: ["direct-http"],
    qualityPreference: "best",
    startupPriority: "balanced",
    ...overrides,
  };
}

function episodeInput(): ProviderResolveInput {
  return movieInput({
    mediaKind: "series",
    title: {
      id: "tmdb:1399",
      kind: "series",
      title: "Game of Thrones",
      imdbId: "tt0944947",
      externalIds: { tmdbId: "1399" },
    },
    episode: { season: 1, episode: 2 },
  });
}

const imdbFor =
  (imdbId: string | null, calls: number[] = []): StremioImdbIdResolver =>
  async ({ tmdbId }) => {
    calls.push(tmdbId);
    return imdbId;
  };

function addonModule(
  options: Partial<Parameters<typeof createStremioAddonProviderModule>[0]> = {},
) {
  return createStremioAddonProviderModule({
    addon: addonRef(),
    name: "Example",
    resolveImdbId: imdbFor("tt1375666"),
    ...options,
  });
}

describe("stremio addon provider", () => {
  test("is a movie and series provider that is never relayed", () => {
    const { manifest, providerId } = addonModule();

    expect(providerId).toBe(addonRef().providerId);
    expect(manifest.displayName).toBe("Example");
    expect(manifest.domain).toBe("addon.example.com");
    expect(manifest.mediaKinds).toEqual(["movie", "series"]);
    expect(manifest.relaySafe).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain(TOKEN);
  });

  test("resolves a movie by the IMDb id mapped from its TMDB id", async () => {
    const lookups: number[] = [];
    const h = harness({
      streams: {
        streams: [
          { url: "https://cdn.example.com/inception.1080p.mp4", name: "Example\n1080p" },
          { url: "https://cdn.example.com/inception.720p.mp4", name: "Example\n720p" },
          { infoHash: "0123456789abcdef0123456789abcdef01234567" },
        ],
      },
    });

    const result = await addonModule({ resolveImdbId: imdbFor("tt1375666", lookups) }).resolve(
      movieInput(),
      h.context,
    );

    expect(lookups).toEqual([27205]);
    expect(h.requested).toContain(`https://addon.example.com/${TOKEN}/stream/movie/tt1375666.json`);
    expect(result.status).toBe("resolved");
    expect(result.streams.map((stream) => stream.url)).toEqual([
      "https://cdn.example.com/inception.1080p.mp4",
      "https://cdn.example.com/inception.720p.mp4",
    ]);
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.url).toBe("https://cdn.example.com/inception.1080p.mp4");
    expect(selected?.flavorLabel).toBe("Example");
    expect(result.streamReachabilityVerified).toBe(true);
    expect(
      result.trace.events?.some(
        (event) => event.type === "source:skipped" && event.message.includes("1 torrent"),
      ),
    ).toBe(true);
  });

  test("asks for an episode as imdb:season:episode, using the id the title already carries", async () => {
    const lookups: number[] = [];
    const h = harness({
      streams: { streams: [{ url: "https://cdn.example.com/s01e02.mp4" }] },
    });

    const result = await addonModule({ resolveImdbId: imdbFor(null, lookups) }).resolve(
      episodeInput(),
      h.context,
    );

    expect(lookups).toEqual([]);
    expect(h.requested).toContain(
      `https://addon.example.com/${TOKEN}/stream/series/tt0944947%3A1%3A2.json`,
    );
    expect(result.status).toBe("resolved");
  });

  test("the mapped IMDb id and the manifest are cached; the stream list is asked every time", async () => {
    const lookups: number[] = [];
    const h = harness({ streams: { streams: [{ url: "https://cdn.example.com/a.mp4" }] } });
    const input = movieInput();

    await addonModule({ resolveImdbId: imdbFor("tt1375666", lookups) }).resolve(input, h.context);
    // A new module is a new session reading the same cache.
    await addonModule({ resolveImdbId: imdbFor("tt1375666", lookups) }).resolve(input, h.context);

    expect(lookups).toEqual([27205]);
    expect(h.requested.filter((url) => url === MANIFEST_URL)).toHaveLength(1);
    expect(h.requested.filter((url) => url.includes("/stream/movie/"))).toHaveLength(2);
  });

  test("a title no catalog has an IMDb id for is not guessed; the addon is never asked", async () => {
    const h = harness({});

    const result = await addonModule({ resolveImdbId: imdbFor(null) }).resolve(
      movieInput(),
      h.context,
    );

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("unsupported-title");
    expect(result.failures[0]?.message).toContain("no catalog records one");
    expect(h.requested).toEqual([]);
  });

  test("a value that is not an IMDb id is treated as no id", async () => {
    const h = harness({});

    const result = await addonModule({ resolveImdbId: imdbFor("Inception (2010)") }).resolve(
      movieInput(),
      h.context,
    );

    expect(result.status).toBe("exhausted");
    expect(h.requested).toEqual([]);
  });

  test("a stream the probe proves dead is skipped and removed from the inventory", async () => {
    const h = harness({
      streams: {
        streams: [
          { url: "https://dead.example.com/a.mp4", name: "Example\n1080p" },
          { url: "https://cdn.example.com/b.mp4", name: "Example\n720p" },
        ],
      },
      media: (url) =>
        url.includes("dead.example.com")
          ? new Response("gone", { status: 404 })
          : new Response("ok"),
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("resolved");
    expect(result.streams.map((stream) => stream.url)).toEqual(["https://cdn.example.com/b.mp4"]);
    expect(result.streams[0]?.id).toBe(result.selectedStreamId);
    expect(result.trace.events?.some((event) => event.type === "source:failed")).toBe(true);
  });

  test("never reports success when every probed stream is dead", async () => {
    const h = harness({
      streams: {
        streams: [
          { url: "https://dead.example.com/a.mp4" },
          { url: "https://dead.example.com/b.mp4" },
        ],
      },
      media: () => new Response("gone", { status: 404 }),
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("exhausted");
    expect(result.streams).toEqual([]);
    expect(result.failures[0]?.message).toContain("unreachable");
  });

  test("the probe sends the stream's own request headers", async () => {
    const h = harness({
      streams: {
        streams: [
          {
            url: "https://cdn.example.com/a.mp4",
            behaviorHints: {
              notWebReady: true,
              proxyHeaders: { request: { Referer: "https://site.example/" } },
            },
          },
        ],
      },
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.streams[0]?.headers).toEqual({ Referer: "https://site.example/" });
    expect(h.probedHeaders.length).toBeGreaterThan(0);
    expect(h.probedHeaders.every((headers) => headers.referer === "https://site.example/")).toBe(
      true,
    );
  });

  test("only unplayable streams is a not-found that says what was offered", async () => {
    const h = harness({
      streams: {
        streams: [
          { infoHash: "0123456789abcdef0123456789abcdef01234567" },
          { externalUrl: "https://example.com/watch" },
        ],
      },
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("not-found");
    expect(result.failures[0]?.message).toContain("1 torrent, 1 external page");
  });

  test("an addon that needs configuring first says so and is not asked for streams", async () => {
    const h = harness({
      manifest: { ...MANIFEST, behaviorHints: { configurationRequired: true } },
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.failures[0]?.code).toBe("missing-input");
    expect(h.requested.filter((url) => url.includes("/stream/"))).toEqual([]);
  });

  test("an addon without movie streams is not asked for a movie", async () => {
    const h = harness({ manifest: { ...MANIFEST, types: ["series"] } });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.failures[0]?.code).toBe("unsupported-title");
    expect(result.failures[0]?.message).toContain("no movie streams");
    expect(h.requested.filter((url) => url.includes("/stream/"))).toEqual([]);
  });

  test("anime, a missing episode, and a removed addon each exhaust without a request", async () => {
    const h = harness({});
    const anime = await addonModule().resolve(movieInput({ mediaKind: "anime" }), h.context);
    const noEpisode = await addonModule().resolve(
      { ...episodeInput(), episode: undefined },
      h.context,
    );
    const removed = await addonModule({ isInstalled: () => false }).resolve(
      movieInput(),
      h.context,
    );

    expect([anime.status, noEpisode.status, removed.status]).toEqual([
      "exhausted",
      "exhausted",
      "exhausted",
    ]);
    expect(removed.failures[0]?.message).toContain("removed");
    expect(h.requested).toEqual([]);
  });

  test("a failed addon request exhausts with its code, and no failure names the addon path", async () => {
    const h = harness({ streams: { error: "bad token" } });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("parse-failed");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test("a resolved result never carries the addon path either", async () => {
    const h = harness({ streams: { streams: [{ url: "https://cdn.example.com/a.mp4" }] } });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("resolved");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test("a pinned source wins over the addon's own order", async () => {
    const h = harness({
      streams: {
        streams: [
          { url: "https://cdn.example.com/a.mp4", behaviorHints: { bingeGroup: "first" } },
          { url: "https://cdn.example.com/b.mp4", behaviorHints: { bingeGroup: "second" } },
        ],
      },
    });
    const module = addonModule();
    const open = await module.resolve(movieInput(), h.context);
    const second = open.streams[1];

    const pinned = await module.resolve(
      movieInput({ preferredSourceId: second?.sourceId }),
      h.context,
    );

    expect(open.selectedStreamId).toBe(open.streams[0]?.id);
    expect(pinned.selectedStreamId).toBe(second?.id);
    expect(second?.sourceId).not.toBe(open.streams[0]?.sourceId);
  });

  test("cancelling before the answer arrives ends as cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness({ signal: controller.signal });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("cancelled");
  });
});
