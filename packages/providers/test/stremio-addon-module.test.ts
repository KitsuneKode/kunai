import { describe, expect, spyOn, test } from "bun:test";

import type { LooseJsonValue, ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { parseStremioAddonUrl } from "../src/stremio-addon/addon-url";
import {
  createStremioAddonProviderModule,
  type StremioImdbIdResolver,
} from "../src/stremio-addon/module";

const TOKEN = "SECRETTOKEN";
const MANIFEST_URL = `https://addon.example.com/${TOKEN}/manifest.json`;
const ROOT_MANIFEST_URL = "https://addon.example.com/manifest.json";

function addonRef() {
  const result = parseStremioAddonUrl(MANIFEST_URL);
  if (!result.ok) throw new Error(result.reason);
  return result.addon;
}

function rootAddonRef() {
  const result = parseStremioAddonUrl(ROOT_MANIFEST_URL);
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

const json = (body: LooseJsonValue) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/**
 * A positive direct-media answer: one complete 24-byte `ftyp` box followed by
 * a one-byte `mdat` box — a header alone is not media evidence.
 */
const MP4_PREFIX = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
  0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
  // 9-byte `mdat` box carrying a single media byte.
  0x00, 0x00, 0x00, 0x09, 0x6d, 0x64, 0x61, 0x74, 0xab,
]);
const directMediaResponse = () => new Response(MP4_PREFIX.slice());

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
  readonly manifest?: LooseJsonValue;
  readonly manifestFetch?: (call: number) => Response | Promise<Response>;
  readonly streams?: LooseJsonValue;
  readonly media?: (url: string, headers: Headers) => Response;
  readonly signal?: AbortSignal;
}): Harness {
  let manifestCalls = 0;
  const requested: string[] = [];
  const probedHeaders: Record<string, string>[] = [];
  const cache = new Map<string, unknown>();
  const context: ProviderRuntimeContext = {
    now: () => new Date().toISOString(),
    signal: options.signal,
    cache: {
      read: async <T>(namespace: string, key: string) =>
        // SAFETY: a cache hands back whatever was written under the key; `T` is
        // the caller's claim, and the module re-checks what it reads.
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
        if (url === MANIFEST_URL || url === ROOT_MANIFEST_URL) {
          manifestCalls += 1;
          return options.manifestFetch?.(manifestCalls) ?? json(options.manifest ?? MANIFEST);
        }
        if (new URL(url).origin === "https://addon.example.com") {
          return json(options.streams ?? { streams: [] });
        }
        const headers = new Headers(init?.headers);
        probedHeaders.push(Object.fromEntries(headers.entries()));
        return options.media?.(url, headers) ?? directMediaResponse();
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
        new URL(url).hostname === "dead.example.com"
          ? new Response("gone", { status: 404 })
          : directMediaResponse(),
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("resolved");
    expect(result.streams.map((stream) => stream.url)).toEqual(["https://cdn.example.com/b.mp4"]);
    expect(result.streams[0]?.id).toBe(result.selectedStreamId);
    expect(result.trace.events?.some((event) => event.type === "source:failed")).toBe(true);
  });

  test("only verified streams reach the result; inconclusive and unprobed ones do not", async () => {
    const probed: string[] = [];
    const h = harness({
      streams: {
        streams: [
          { url: "https://cdn.example.com/one.mp4" },
          { url: "https://cdn.example.com/two.mp4" },
          { url: "https://cdn.example.com/three.mp4" },
          { url: "https://cdn.example.com/four.mp4" },
        ],
      },
      media: (url) => {
        probed.push(url);
        // A non-definitive refusal: accepted by the gate, but not verified.
        return new URL(url).pathname === "/two.mp4"
          ? new Response("broken", { status: 500 })
          : directMediaResponse();
      },
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("resolved");
    // The gate walks at most RESOLVE_GATE_MAX_PROBES candidates; the fourth is
    // never asked about, and the inconclusive one is not reported either.
    expect([...new Set(probed)].sort()).toEqual(
      [
        "https://cdn.example.com/one.mp4",
        "https://cdn.example.com/two.mp4",
        "https://cdn.example.com/three.mp4",
      ].sort(),
    );
    expect(result.streams.map((stream) => stream.url)).toEqual([
      "https://cdn.example.com/one.mp4",
      "https://cdn.example.com/three.mp4",
    ]);
    expect(result.variants?.flatMap((variant) => variant.streamIds)).toEqual(
      result.streams.map((stream) => stream.id),
    );
    expect(result.selectedStreamId).toBe(result.streams[0]?.id);
    expect(result.streamReachabilityVerified).toBe(true);
  });

  test("probes that only reach an inconclusive verdict exhaust instead of reporting success", async () => {
    const h = harness({
      streams: {
        streams: [
          { url: "https://cdn.example.com/a.mp4" },
          { url: "https://cdn.example.com/b.mp4" },
        ],
      },
      media: () => new Response("broken", { status: 500 }),
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("exhausted");
    expect(result.streams).toEqual([]);
    expect(result.failures[0]?.message).toContain("did not provide a verified stream");
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
    expect(result.failures[0]?.message).toContain("did not provide a verified stream");
  });

  test("playlist URLs and playlist bodies are refused without a child fetch", async () => {
    const fetched: string[] = [];
    const h = harness({
      streams: {
        streams: [
          { url: "https://cdn.example.com/master.m3u8" },
          { url: "https://cdn.example.com/extensionless" },
          { url: "https://cdn.example.com/manifest" },
        ],
      },
      media: (url) => {
        fetched.push(url);
        if (new URL(url).pathname === "/extensionless") {
          // An HLS master naming a child the probe must never ask for.
          return new Response(
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://child.invalid/seg.m3u8\n",
          );
        }
        return new Response(
          '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period/></MPD>',
        );
      },
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("exhausted");
    expect(result.streams).toEqual([]);
    // `.m3u8` is refused before a request exists; extensionless playlist bodies
    // each cost exactly one bounded GET and no child is ever fetched.
    expect([...fetched].sort()).toEqual(
      ["https://cdn.example.com/extensionless", "https://cdn.example.com/manifest"].sort(),
    );
    expect(fetched.some((url) => url.includes("child.invalid"))).toBe(false);
    expect(result.trace.events?.some((event) => event.type === "source:failed")).toBe(true);
  });

  test("a redirect answer is refused rather than followed, and the trace names no URL", async () => {
    const fetched: string[] = [];
    const h = harness({
      streams: { streams: [{ url: "https://cdn.example.com/a.mp4" }] },
      media: (url) => {
        fetched.push(url);
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/redirected.mp4" },
        });
      },
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("exhausted");
    expect(fetched).toEqual(["https://cdn.example.com/a.mp4"]);
    expect(JSON.stringify(result.trace.events)).not.toContain("redirected.mp4");
    expect(JSON.stringify(result.trace.events)).not.toContain("a.mp4");
  });

  test("a pathless URL serving a real MP4 prefix is accepted", async () => {
    const h = harness({
      streams: { streams: [{ url: "https://cdn.example.com" }] },
      media: () => directMediaResponse(),
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("resolved");
    expect(result.streams.map((stream) => stream.url)).toEqual(["https://cdn.example.com"]);
    expect(result.streamReachabilityVerified).toBe(true);
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
    const module = addonModule({ addon: rootAddonRef() });
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

describe("stremio addon manifest commit", () => {
  test("the first manifest to land commits; a slower competing fetch cannot overwrite it", async () => {
    const releases: Array<(response: Response) => void> = [];
    const h = harness({
      manifestFetch: () =>
        new Promise<Response>((resolve) => {
          releases.push(resolve);
        }),
      streams: { streams: [] },
    });
    const names: string[] = [];
    const module = addonModule({
      addon: rootAddonRef(),
      onManifest: (manifest) => names.push(manifest.name),
    });
    const movie = movieInput();

    const first = module.resolve(movie, h.context);
    const second = module.resolve(movie, h.context);
    while (releases.length < 2) await Promise.resolve();
    releases[0]?.(json(MANIFEST));
    releases[1]?.(json({ ...MANIFEST, name: "Other Addon", types: ["series"] }));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(names).toEqual(["Example"]);
    expect(firstResult.status).toBe("exhausted");
    expect(secondResult.status).toBe("exhausted");
    const cached = h.cache.get(`stremio-addon:manifest|${rootAddonRef().providerId}`);
    expect(cached).toMatchObject({ name: "Example" });
  });

  test("a cached manifest committed by a racing caller wins; the loser never re-commits", async () => {
    const h = harness({ streams: { streams: [] } });
    h.cache.set(`stremio-addon:manifest|${rootAddonRef().providerId}`, MANIFEST);
    // Gate each manifest cache read so both resolves are in flight before the
    // first answer lands — the second must then see the committed winner.
    const gates: Array<() => void> = [];
    const cache = h.context.cache;
    if (!cache) throw new Error("harness must provide a cache");
    const baseRead = cache.read;
    cache.read = async <T>(namespace: string, key: string) => {
      if (namespace === "stremio-addon:manifest") {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
      }
      return baseRead<T>(namespace, key);
    };
    const names: string[] = [];
    const module = addonModule({
      addon: rootAddonRef(),
      onManifest: (manifest) => names.push(manifest.name),
    });
    const movie = movieInput();

    const first = module.resolve(movie, h.context);
    const second = module.resolve(movie, h.context);
    while (gates.length < 2) await Promise.resolve();
    gates[0]?.();
    const firstResult = await first;
    gates[1]?.();
    const secondResult = await second;

    expect(names).toEqual(["Example"]);
    expect(firstResult.status).toBe("exhausted");
    expect(secondResult.status).toBe("exhausted");
    expect(h.requested).not.toContain(ROOT_MANIFEST_URL);
  });
});

describe("stremio addon resolve gate", () => {
  test("quality-first walks the best remaining candidate after a dead pick", async () => {
    const qualities = [480, 720, 1080, 1440, 2160];
    const h = harness({
      streams: {
        streams: qualities.map((quality) => ({
          url: `https://cdn.example.com/movie.${quality}p.mp4`,
          name: "Example",
          description: `Movie release ${quality}p`,
        })),
      },
      media: (url) =>
        url.includes("2160p") ? new Response("gone", { status: 404 }) : directMediaResponse(),
    });

    const result = await addonModule().resolve(
      movieInput({ startupPriority: "quality-first" }),
      h.context,
    );

    expect(result.status).toBe("resolved");
    expect(h.requested.filter((url) => url.startsWith("https://cdn.example.com/"))).toEqual([
      "https://cdn.example.com/movie.2160p.mp4",
      "https://cdn.example.com/movie.1440p.mp4",
      "https://cdn.example.com/movie.1080p.mp4",
    ]);
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.qualityLabel).toBe("1440p");
  });

  test("a candidate whose strict probe only ever times out is a retryable failure, not a pass", async () => {
    const deadlines: AbortController[] = [];
    const spy = spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      deadlines.push(controller);
      return controller.signal;
    });
    try {
      const h = harness({
        streams: { streams: [{ url: "https://cdn.example.com/a.mp4" }] },
        media: () => {
          const latest = deadlines.at(-1);
          latest?.abort();
          throw new Error("deadline elapsed");
        },
      });

      const result = await addonModule().resolve(movieInput(), h.context);

      // Two probes of the one candidate (the gate retries an inconclusive
      // answer once) — never a silent pass.
      expect(h.requested.filter((url) => url === "https://cdn.example.com/a.mp4")).toHaveLength(2);
      expect(result.status).toBe("exhausted");
      expect(result.failures[0]).toMatchObject({ code: "timeout", retryable: true });
      expect(
        result.trace.events?.some(
          (event) => event.type === "source:failed" && event.attributes?.["reason"] === "timeout",
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("one URL carrying different header values is probed per request; only the verified headers ship", async () => {
    const h = harness({
      streams: {
        streams: [
          {
            url: "https://cdn.example.com/same.mp4",
            name: "Example\nfirst",
            behaviorHints: { proxyHeaders: { request: { "x-token": "bad" } } },
          },
          {
            url: "https://cdn.example.com/same.mp4",
            name: "Example\nsecond",
            behaviorHints: { proxyHeaders: { request: { "x-token": "good" } } },
          },
        ],
      },
      media: (_url, headers) =>
        headers.get("x-token") === "good"
          ? directMediaResponse()
          : new Response("denied", { status: 403 }),
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("resolved");
    expect(h.probedHeaders.map((headers) => headers["x-token"])).toEqual(["bad", "good"]);
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.headers).toEqual({ "x-token": "good" });
    // The request key (which embeds the header value) never reaches output.
    expect(JSON.stringify(result)).not.toContain('"requestKey"');
  });

  test("a subtitle URL shared by verified variants yields one distinct id per variant", async () => {
    const shared = "https://subs.example.com/en.srt";
    const h = harness({
      streams: {
        streams: [
          {
            url: "https://cdn.example.com/a.1080p.mp4",
            name: "Example\n1080p",
            subtitles: [
              { url: shared, lang: "en" },
              { url: shared, lang: "en" },
            ],
          },
          {
            url: "https://cdn.example.com/a.720p.mp4",
            name: "Example\n720p",
            subtitles: [{ url: shared, lang: "en" }],
          },
        ],
      },
    });

    const result = await addonModule().resolve(movieInput(), h.context);

    expect(result.status).toBe("resolved");
    expect(result.subtitles).toHaveLength(2);
    const [firstSub, secondSub] = result.subtitles;
    expect(firstSub?.id).not.toBe(secondSub?.id);
    expect(firstSub?.variantId).not.toBe(secondSub?.variantId);
    const variantIds = new Set((result.variants ?? []).map((variant) => variant.id));
    for (const subtitle of result.subtitles) {
      expect(variantIds.has(subtitle.variantId ?? "")).toBe(true);
      const variant = (result.variants ?? []).find(
        (candidate) => candidate.id === subtitle.variantId,
      );
      expect(variant?.subtitleIds).toEqual([subtitle.id]);
    }
  });
});
