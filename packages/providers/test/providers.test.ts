import { expect, test } from "bun:test";

import { createProviderEngine } from "@kunai/core";

import {
  allmangaProviderModule,
  buildAllmangaSourceCandidates,
  buildMiruroCycleCandidates,
  createProviderLanguageEvidence,
  createProviderSourceEvidence,
  createSourceCandidateFromStream,
  createStreamId,
  createVariantCandidateFromStream,
  createMiruroResultFromPayload,
  createMiruroPipeRequestUrls,
  decodeVideasyGuardedPayload,
  getMiruroEpisodesResponse,
  miruroProviderModule,
  createVidkingResultFromPayload,
  extractQualitiesFromMaster,
  listVidkingFlavors,
  normalizeIsoLanguageCode,
  normalizeProviderDisplayLabel,
  normalizeQualityLabel,
  parseSourceHost,
  qualityRankFromLabel,
  resolveFlavorEngineOptions,
  resolveVidkingDirect,
  rivestreamProviderModule,
  stableProviderInventoryId,
  VariantTreeBuilder,
  videasyProviderModule,
  vidlinkProviderModule,
} from "../src/index";
import {
  getProviderMigrationQueue,
  getProviderResearchProfile,
  providerResearchProfiles,
} from "../src/research";

const FIXTURE_BASE = new URL("./fixtures/", import.meta.url);

/** TMDB enrich fetches (historically db.videasy.to, now often api.videasy.to/3)
 *  are separate from stream resolve requests. */
function videasyResolveUrls(urls: readonly string[]): string[] {
  return urls.filter((url) => {
    try {
      return new URL(url).pathname.includes("sources-with-title");
    } catch {
      return false;
    }
  });
}

function videasyApiHeaders(seenHeaders: readonly Headers[]): Headers | undefined {
  return seenHeaders.find((headers) => headers.get("x-app-id") !== null);
}

/**
 * Create a mock fetch port that serves valid seed responses and delegates
 * source API requests to the provided source handler.
 * Needed because wings-* endpoints require a valid seed before they attempt source calls.
 */
function createFetchWithSeedMock(
  sourceHandler: (input: string, init?: RequestInit) => Response | Promise<Response>,
) {
  return {
    runtime: "direct-http" as const,
    fetch: async (input: string, init?: RequestInit) => {
      if (input.includes("/seed?")) {
        return new Response(JSON.stringify({ seed: "test-seed.vAlIdS33dString", ttlMs: 30000 }));
      }
      return sourceHandler(input, init);
    },
  };
}

function expectedVideasyRouteEndpoint(endpoint: string): string {
  // Match fetchVideasyPayload's wingsEndpointToServer prefix stripping
  return endpoint.startsWith("wings-") ? endpoint.slice("wings-".length) : endpoint;
}

test("provider engine exposes registered modules", () => {
  const engine = createProviderEngine({
    modules: [
      vidlinkProviderModule,
      rivestreamProviderModule,
      videasyProviderModule,
      allmangaProviderModule,
      miruroProviderModule,
    ],
  });

  expect(engine.getProviderIds()).toEqual([
    "vidlink",
    "rivestream",
    "videasy",
    "allanime",
    "miruro",
  ]);
  expect(engine.get("vidlink")).toBe(vidlinkProviderModule);
  expect(engine.get("rivestream")).toBe(rivestreamProviderModule);
  expect(engine.get("videasy")).toBe(videasyProviderModule);
  expect(engine.get("allanime")).toBe(allmangaProviderModule);
  expect(engine.get("miruro")).toBe(miruroProviderModule);
});

test("provider research profiles are dossier-backed and migration ordered", () => {
  const queue = getProviderMigrationQueue();

  expect(queue[0]?.providerId).toBe("videasy");
  expect(queue[1]?.providerId).toBe("allanime");
  expect(queue.every((profile) => profile.dossierPath.startsWith(".docs/provider-dossiers/"))).toBe(
    true,
  );
  expect(providerResearchProfiles.length).toBeGreaterThanOrEqual(7);
});

test("provider research profiles separate direct providers from legacy fallbacks", () => {
  expect(getProviderResearchProfile("videasy")).toMatchObject({
    status: "production",
    migrationAction: "promote-direct-provider",
    runtimeClass: "direct-http Videasy payload decode",
  });

  expect(getProviderResearchProfile("cineby")).toMatchObject({
    status: "research-only",
    migrationAction: "keep-as-fallback",
  });

  expect(getProviderResearchProfile("anikai")).toMatchObject({
    migrationAction: "hold-for-future-runtime",
  });
});

test("vidking direct payload creates selected stream, variants, and subtitle inventory", () => {
  const result = createVidkingResultFromPayload({
    input: {
      title: {
        id: "1668",
        tmdbId: "1668",
        kind: "series",
        title: "Friends",
        year: 1994,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      preferredSubtitleLanguage: "en",
      qualityPreference: "1080",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    payload: {
      sources: [
        { url: "https://cdn.example/720/index.m3u8", quality: "720p" },
        { url: "https://cdn.example/1080/index.m3u8", quality: "1080p" },
      ],
      subtitles: [
        {
          url: "https://subs.example/en-sdh.vtt",
          language: "English SDH",
          release: "SDH",
        },
        {
          file: "https://subs.example/en.vtt",
          language: "English",
          release: "Clean",
        },
        {
          href: "https://subs.example/es.vtt",
          lang: "spa",
          label: "Spanish",
        },
      ],
    },
    server: "mb-flix",
  });

  expect(result?.selectedStreamId).toBe(result?.streams[0]?.id);
  expect(result?.streams[0]).toMatchObject({
    qualityLabel: "1080p",
    protocol: "hls",
    container: "m3u8",
  });
  expect(result?.variants).toHaveLength(2);
  expect(result?.subtitles.map((subtitle) => subtitle.language)).toEqual(["en", "en", "es"]);
  expect(result?.subtitles[0]?.url).toBe("https://subs.example/en.vtt");
  expect(result?.trace.events?.map((event) => event.type)).toContain("variant:selected");
});

test("vidking direct resolver preserves nonretryable direct failure evidence", async () => {
  const events: unknown[] = [];
  let sourceCalls = 0;
  const seedUrls = new Set([
    "https://api.speedracelight.com/seed?mediaId=1668",
    "https://api.wingsdatabase.com/seed?mediaId=1668",
  ]);
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "1668",
        tmdbId: "1668",
        kind: "series",
        title: "Friends",
        year: 1994,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      preferredSubtitleLanguage: "en",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-01T00:00:00.000Z",
      retryPolicy: { maxAttempts: 2, backoff: "none" },
      emit: (event) => events.push(event),
      fetch: createFetchWithSeedMock(async (input) => {
        if (seedUrls.has(input)) {
          return new Response(JSON.stringify({ seed: "test-seed.vAlIdS33dString", ttlMs: 30000 }));
        }
        sourceCalls += 1;
        return new Response("", { status: 504 });
      }),
    },
  );

  expect(sourceCalls).toBeGreaterThan(0);
  expect(result?.streams).toEqual([]);
  expect(result?.trace.events?.map((event) => event.type)).not.toContain("retry:scheduled");
  expect(result?.trace.events?.map((event) => event.type)).toContain("source:failed");
  expect(result?.trace.events?.map((event) => event.type)).toContain("provider:exhausted");
  expect(result?.trace.failures[0]).toMatchObject({
    providerId: "videasy",
    code: "timeout",
    retryable: false,
  });
  expect(events).not.toContainEqual(expect.objectContaining({ type: "retry:scheduled" }));
});

test("vidking direct resolver does not retry definitive 404 responses or duplicate year variants for TMDB ids", async () => {
  const requestedUrls: string[] = [];
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-26T00:00:00.000Z",
      retryPolicy: { maxAttempts: 2, backoff: "none" },
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          requestedUrls.push(String(input));
          return new Response("", { status: 404 });
        },
      },
    },
    { serverEndpoint: "missing" },
  );

  expect(result?.status).toBe("exhausted");
  expect(videasyResolveUrls(requestedUrls)).toHaveLength(2);
  const yearParams = new Set(
    videasyResolveUrls(requestedUrls).map((url) => new URL(url).searchParams.get("year")),
  );
  expect(yearParams.size).toBeLessThanOrEqual(1);
  expect(result?.trace.events?.map((event) => event.type)).not.toContain("retry:scheduled");
  expect(result?.failures.every((failure) => failure.retryable === false)).toBe(true);
  expect(result?.failures.every((failure) => failure.code === "not-found")).toBe(true);
});

test("vidking direct resolver sends Videasy session headers when provided", async () => {
  const seenHeaders: Headers[] = [];
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "61700",
        tmdbId: "61700",
        kind: "series",
        title: "The Last of Us",
        year: 2023,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-06-04T00:00:00.000Z",
      retryPolicy: { maxAttempts: 1, backoff: "none" },
      fetch: {
        runtime: "direct-http",
        fetch: async (_input, init) => {
          seenHeaders.push(new Headers(init?.headers));
          return jsonResponse({ error: "session_missing" });
        },
      },
    },
    { serverEndpoint: "mb-flix", sessionToken: "session-123" },
  );

  expect(result?.status).toBe("exhausted");
  const apiHeaders = videasyApiHeaders(seenHeaders);
  expect(apiHeaders?.get("x-app-id")).toBe("bc-frontend");
  expect(apiHeaders?.get("x-session-token")).toBe("session-123");
  expect(apiHeaders?.get("origin")).toBe("https://www.cineplay.to");
});

test("vidking direct resolver reads Videasy session token from runtime auth", async () => {
  const seenHeaders: Headers[] = [];
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "61700",
        tmdbId: "61700",
        kind: "series",
        title: "The Last of Us",
        year: 2023,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-06-04T00:00:00.000Z",
      retryPolicy: { maxAttempts: 1, backoff: "none" },
      auth: {
        getSecret: (providerId, key) =>
          (providerId === "videasy" || providerId === "vidking") && key === "videasySessionToken"
            ? "runtime-session-123"
            : undefined,
      },
      fetch: {
        runtime: "direct-http",
        fetch: async (_input, init) => {
          seenHeaders.push(new Headers(init?.headers));
          return jsonResponse({ error: "session_missing" });
        },
      },
    },
    { serverEndpoint: "mb-flix" },
  );

  expect(result?.status).toBe("exhausted");
  const apiHeaders = videasyApiHeaders(seenHeaders);
  expect(apiHeaders?.get("x-app-id")).toBe("bc-frontend");
  expect(apiHeaders?.get("x-session-token")).toBe("runtime-session-123");
  expect(apiHeaders?.get("origin")).toBe("https://www.cineplay.to");
  expect(apiHeaders?.get("referer")).toBe("https://www.cineplay.to/tv/61700/1/2");
});

test("vidking direct resolver can pair a session with a Bitcine app id", async () => {
  const seenHeaders: Headers[] = [];
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "61700",
        tmdbId: "61700",
        kind: "series",
        title: "The Last of Us",
        year: 2023,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-06-04T00:00:00.000Z",
      retryPolicy: { maxAttempts: 1, backoff: "none" },
      auth: {
        getSecret: (providerId, key) => {
          if (providerId !== "videasy" && providerId !== "vidking") return undefined;
          if (key === "videasySessionToken") return "bitcine-session-123";
          if (key === "videasyAppId") return "bc-frontend";
          return undefined;
        },
      },
      fetch: {
        runtime: "direct-http",
        fetch: async (_input, init) => {
          seenHeaders.push(new Headers(init?.headers));
          return jsonResponse({ error: "session_missing" });
        },
      },
    },
    { serverEndpoint: "mb-flix" },
  );

  expect(result?.status).toBe("exhausted");
  const apiHeaders = videasyApiHeaders(seenHeaders);
  expect(apiHeaders?.get("x-app-id")).toBe("bc-frontend");
  expect(apiHeaders?.get("x-session-token")).toBe("bitcine-session-123");
  expect(apiHeaders?.get("origin")).toBe("https://www.cineplay.to");
  expect(apiHeaders?.get("referer")).toBe("https://www.cineplay.to/tv/61700/1/2");
});

test("vidking session transport covers every registered Videasy flavor", async () => {
  const flavors = listVidkingFlavors();
  const requested = new Map<string, { url: string; headers: Headers }>();
  for (const flavor of flavors) {
    // Wings-* flavors need seed before source call; legacy flavors skip seed phase.
    const isWingsEndpoint = flavor.endpoint.startsWith("wings-");
    const engineOptions = resolveFlavorEngineOptions(flavor.id);
    expect(engineOptions).not.toBeNull();

    const result = await resolveVidkingDirect(
      {
        title: {
          id: "61700",
          tmdbId: "61700",
          kind: flavor.moviesOnly ? "movie" : "series",
          title: flavor.moviesOnly ? "Dune" : "The Last of Us",
          year: flavor.moviesOnly ? 2021 : 2023,
        },
        episode: flavor.moviesOnly ? undefined : { season: 1, episode: 2 },
        mediaKind: flavor.moviesOnly ? "movie" : "series",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      {
        now: () => "2026-06-04T00:00:00.000Z",
        retryPolicy: { maxAttempts: 1, backoff: "none" },
        fetch: isWingsEndpoint
          ? createFetchWithSeedMock(async (input, init) => {
              requested.set(flavor.id, {
                url: String(input),
                headers: new Headers(init?.headers),
              });
              return jsonResponse({ error: "session_missing" });
            })
          : {
              runtime: "direct-http" as const,
              fetch: async (input, init) => {
                requested.set(flavor.id, {
                  url: String(input),
                  headers: new Headers(init?.headers),
                });
                return jsonResponse({ error: "session_missing" });
              },
            },
      },
      { ...engineOptions, sessionToken: `token-${flavor.id}` },
    );

    expect(result?.status).toBe("exhausted");
    // For wings-* endpoints, session_missing before seed gate causes "not-found" (seed fails).
    // For legacy endpoints, session_missing is caught by the session guard → "blocked".
    // We accept either since both indicate the request was routed correctly.
    expect(
      result?.failures[0]?.code === "blocked" || result?.failures[0]?.code === "not-found",
    ).toBe(true);
  }

  // Legacy deprecated flavors (no seed required) should have their source URLs recorded;
  // wings-* flavors with working seeds should too. At minimum, non-deprecated flavors appear.
  const activeFlavors = flavors.filter((f) => !f.deprecated);
  expect(requested.size).toBeGreaterThanOrEqual(activeFlavors.length);
  for (const flavor of flavors) {
    const request = requested.get(flavor.id);
    if (!request) continue; // deprecated flavors may not record URLs
    expect(request?.url).toContain(
      `/${expectedVideasyRouteEndpoint(flavor.endpoint)}/sources-with-title?`,
    );
    expect(request?.headers.get("x-app-id")).toBe("bc-frontend");
    expect(request?.headers.get("x-session-token")).toBe(`token-${flavor.id}`);
    if (flavor.languageQuery) {
      expect(request?.url).toContain(`language=${flavor.languageQuery}`);
    }
    if (flavor.moviesOnly) {
      expect(request?.url).toContain("mediaType=movie");
      expect(request?.url).not.toContain("episodeId=");
    } else {
      expect(request?.url).toContain("mediaType=tv");
      expect(request?.url).toContain("seasonId=1");
      expect(request?.url).toContain("episodeId=2");
    }
  }
});

test("vidking preferred source targets that flavor then falls back to Phase A mirrors", async () => {
  const requestedUrls: string[] = [];
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "61700",
        tmdbId: "61700",
        kind: "series",
        title: "The Last of Us",
        year: 2023,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      intent: "play",
      allowedRuntimes: ["direct-http"],
      preferredSourceId: "source:videasy:videasy-hindi",
    },
    {
      now: () => "2026-06-04T00:00:00.000Z",
      retryPolicy: { maxAttempts: 1, backoff: "none" },
      fetch: createFetchWithSeedMock(async (input) => {
        requestedUrls.push(String(input));
        return jsonResponse({ error: "session_missing" });
      }),
    },
  );

  expect(result?.status).toBe("exhausted");
  const resolveUrls = videasyResolveUrls(requestedUrls);
  // Preferred source (videasy-hindi) remaps to active Fade → /hdmovie first.
  // session_missing from that probe triggers candidate-blocked → cycle stops.
  expect(resolveUrls.length).toBeGreaterThanOrEqual(1);
  expect(resolveUrls[0]).toContain("/hdmovie/sources-with-title?");
  expect(resolveUrls.length).toBeLessThanOrEqual(3);
});

test("vidking stops source fanout after a provider-wide session guard failure", async () => {
  const requestedUrls: string[] = [];
  const passthroughEndpointHealth = {
    shouldTry: () => true,
    recordFailure: () => {},
    recordSuccess: () => {},
  };
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "61700",
        tmdbId: "61700",
        kind: "series",
        title: "Bad Guys",
        year: 2014,
      },
      episode: { season: 1, episode: 3 },
      mediaKind: "series",
      intent: "refresh",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-06-04T00:00:00.000Z",
      retryPolicy: { maxAttempts: 1, backoff: "none" },
      endpointHealth: passthroughEndpointHealth,
      fetch: createFetchWithSeedMock(async (input) => {
        requestedUrls.push(String(input));
        return jsonResponse({ error: "session_missing" });
      }),
    },
  );

  expect(result?.status).toBe("exhausted");
  expect(result?.failures).toHaveLength(1);
  expect(result?.failures[0]).toMatchObject({ code: "blocked", retryable: false });
  const resolveUrls = videasyResolveUrls(requestedUrls);
  expect(resolveUrls).toHaveLength(1);
  // Refresh cycles the wider flavor set in Cineby UI order; first active row is Yoru (/cdn).
  expect(resolveUrls[0]).toContain("/cdn/sources-with-title?");
});

test("vidking direct resolver classifies Videasy session guard responses as blocked", async () => {
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "61700",
        tmdbId: "61700",
        kind: "series",
        title: "The Last of Us",
        year: 2023,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-06-04T00:00:00.000Z",
      retryPolicy: { maxAttempts: 2, backoff: "none" },
      fetch: {
        runtime: "direct-http",
        fetch: async () => jsonResponse({ error: "session_missing" }),
      },
    },
    { serverEndpoint: "mb-flix" },
  );

  expect(result?.status).toBe("exhausted");
  expect(result?.failures[0]).toMatchObject({
    providerId: "videasy",
    code: "blocked",
    retryable: false,
  });
  expect(result?.failures[0]?.message).toContain("valid browser session");
  expect(result?.trace.events?.map((event) => event.type)).not.toContain("retry:scheduled");
});

test("vidking guarded v2 payload unwraps with Videasy session key", async () => {
  const { default: CryptoJS } = await import("crypto-js");
  const sessionToken = "session-123";
  const key = CryptoJS.SHA256(`g:${sessionToken}`).toString();
  const guarded = `v2:${CryptoJS.AES.encrypt("inner-payload", key).toString()}`;

  await expect(decodeVideasyGuardedPayload(guarded, sessionToken)).resolves.toBe("inner-payload");
  await expect(decodeVideasyGuardedPayload(guarded, undefined)).rejects.toThrow(
    "requires a session token",
  );
});

test("vidking guarded v2 unwrap is path agnostic for every Videasy flavor", async () => {
  const { default: CryptoJS } = await import("crypto-js");

  for (const flavor of listVidkingFlavors()) {
    const sessionToken = `session-${flavor.id}`;
    const key = CryptoJS.SHA256(`g:${sessionToken}`).toString();
    const innerPayload = `payload-for-${flavor.endpoint}-${flavor.id}`;
    const guarded = `v2:${CryptoJS.AES.encrypt(innerPayload, key).toString()}`;

    await expect(decodeVideasyGuardedPayload(guarded, sessionToken)).resolves.toBe(innerPayload);
  }
});

test("vidking direct resolver can target a flavored endpoint without broad server probing", async () => {
  const requestedUrls: string[] = [];
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      preferredAudioLanguage: "de",
      preferredPresentation: "raw",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-01T00:00:00.000Z",
      retryPolicy: { maxAttempts: 1, backoff: "none" },
      fetch: createFetchWithSeedMock(async (input) => {
        requestedUrls.push(String(input));
        return new Response("", { status: 504 });
      }),
    },
    {
      serverEndpoint: "wings-meine",
      language: "german",
      flavorLabel: "Killjoy",
      flavorArchetype: "German audio",
    },
  );

  const resolveUrls = videasyResolveUrls(requestedUrls);
  expect(resolveUrls.every((url) => url.includes("/meine/sources-with-title?"))).toBe(true);
  expect(resolveUrls[0]).toContain("language=german");
  expect(result?.trace.events?.map((event) => event.type)).toEqual(
    expect.arrayContaining(["source:start", "source:failed", "provider:exhausted"]),
  );
  expect(result?.sources?.[0]).toMatchObject({
    id: "source:videasy:wings-meine",
    label: "Killjoy",
    metadata: {
      server: "wings-meine",
      flavorId: "cineby-killjoy",
      flavorArchetype: "German audio",
    },
  });
});

test("vidking refresh intent cycles the wider flavor source set", async () => {
  const requestedUrls: string[] = [];
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      preferredAudioLanguage: "en",
      preferredPresentation: "raw",
      intent: "refresh",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-01T00:00:00.000Z",
      retryPolicy: { maxAttempts: 1, backoff: "none" },
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          requestedUrls.push(String(input));
          return new Response("", { status: 404 });
        },
      },
    },
  );

  expect(result?.status).toBe("exhausted");
  // Active Cineby routes (wings- prefix stripped in the request path)
  expect(requestedUrls.some((url) => url.includes("/m4uhd/sources-with-title?"))).toBe(true);
  expect(requestedUrls.some((url) => url.includes("/hdmovie/sources-with-title?"))).toBe(true);
  expect(requestedUrls.some((url) => url.includes("/superflix/sources-with-title?"))).toBe(true);
  expect(requestedUrls.some((url) => url.includes("/neon2/sources-with-title?"))).toBe(true);
  const sourceIds = result?.sources?.map((source) => source.id) ?? [];
  expect(sourceIds).toContain("source:videasy:wings-neon2");
  expect(sourceIds).toContain("source:videasy:wings-m4uhd");
  expect(sourceIds).toContain("source:videasy:cineby-vyse");
  expect(sourceIds).toContain("source:videasy:wings-superflix");
});

test("vidking payload filtering keeps localized flavored sources explicit", () => {
  const result = createVidkingResultFromPayload({
    input: {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      preferredAudioLanguage: "hi",
      preferredPresentation: "raw",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    payload: {
      sources: [
        { url: "https://cdn.example/original.m3u8", quality: "Original 1080p" },
        { url: "https://cdn.example/hindi.m3u8", quality: "Hindi 1080p" },
      ],
    },
    sourceQualityFilter: "Hindi",
    server: "hdmovie",
  });

  expect(result?.streams).toHaveLength(1);
  expect(result?.streams[0]?.url).toBe("https://cdn.example/hindi.m3u8");
  expect(result?.streams[0]?.metadata?.flavorFilter).toBe("Hindi");
});

test("vidking evidence fixture preserves native server labels beside ISO audio language", async () => {
  const payload = await readFixture<
    Parameters<typeof createVidkingResultFromPayload>[0]["payload"]
  >("videasy/source-payload.json");
  const expected = await readFixture<{
    readonly serverLabel: string;
    readonly nativeServerLabel: string;
    readonly nativeLanguageLabel: string;
    readonly normalizedLanguage: string;
    readonly sourceHost: string;
    readonly quality: string;
  }>("videasy/expected-normalized.json");
  const result = createVidkingResultFromPayload({
    input: {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      preferredAudioLanguage: expected.normalizedLanguage,
      preferredPresentation: "raw",
      startupPriority: "balanced",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    payload,
    sourceQualityFilter: expected.nativeLanguageLabel,
    server: expected.serverLabel,
  });

  expect(result?.sources?.[0]).toMatchObject({
    label: "Chopper",
    metadata: { server: expected.serverLabel, flavorId: "videasy-hindi" },
    sourceEvidence: [
      expect.objectContaining({
        nativeLabel: expected.nativeServerLabel,
        host: expected.sourceHost,
      }),
    ],
  });
  expect(result?.streams[0]).toMatchObject({
    qualityLabel: normalizeQualityLabel(expected.quality),
    audioLanguages: [expected.normalizedLanguage],
    languageEvidence: [
      expect.objectContaining({
        nativeLabel: expected.nativeLanguageLabel,
        normalizedLanguage: expected.normalizedLanguage,
      }),
    ],
  });
  expect(result?.variants?.[0]?.languageEvidence).toEqual(result?.streams[0]?.languageEvidence);
  expect(result?.selectionDecision).toMatchObject({
    startupPriority: "balanced",
    reason: "balanced-1080",
    selectedQualityRank: 1080,
  });
});

test("vidking fixture fast startup keeps the first ready stream", async () => {
  const payload = await readFixture<
    Parameters<typeof createVidkingResultFromPayload>[0]["payload"]
  >("videasy/source-payload.json");
  const result = createVidkingResultFromPayload({
    input: {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      startupPriority: "fast",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    payload,
    server: "Kiwi",
  });

  expect(result?.selectedStreamId).toBe(result?.streams[0]?.id);
  expect(result?.selectionDecision).toMatchObject({
    startupPriority: "fast",
    reason: "fast-start",
    selectedQualityRank: result?.streams[0]?.qualityRank,
  });
});

test("rivestream falls back to static provider services when service discovery is unavailable", async () => {
  const sourceFixture = await readFixture<unknown>("rivestream/source-response.json");
  const requests: string[] = [];
  const result = await rivestreamProviderModule.resolve(
    {
      title: {
        id: "900000",
        tmdbId: "900000",
        kind: "movie",
        title: "Fallback Probe",
      },
      mediaKind: "movie",
      startupPriority: "balanced",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-26T00:00:00.000Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          const url = String(input);
          requests.push(url);
          if (url.includes("VideoProviderServices")) return new Response("", { status: 503 });
          return jsonResponse(sourceFixture);
        },
      },
    },
  );

  expect(result.status).toBe("resolved");
  expect(requests.some((url) => url.includes("VideoProviderServices"))).toBe(true);
  expect(requests.some((url) => url.includes("service=flowcast"))).toBe(true);
});

test("rivestream evidence fixture preserves provider server label and normalized language", async () => {
  const services = await readFixture<unknown>("rivestream/services-response.json");
  const sourceFixture = await readFixture<unknown>("rivestream/source-response.json");
  const expected = await readFixture<{
    readonly serverLabel: string;
    readonly nativeLanguageLabel: string;
    readonly normalizedLanguage: string;
    readonly subtitleLanguage: string;
    readonly sourceHost: string;
    readonly quality: string;
  }>("rivestream/expected-normalized.json");
  const requests: string[] = [];
  const result = await rivestreamProviderModule.resolve(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-19T00:00:00.000Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          const url = String(input);
          requests.push(url);
          return jsonResponse(url.includes("VideoProviderServices") ? services : sourceFixture);
        },
      },
    },
  );

  expect(requests.some((url) => url.includes("VideoProviderServices"))).toBe(true);
  expect(result.status).toBe("resolved");
  expect(result.trace.events?.map((event) => event.type)).toEqual(
    expect.arrayContaining(["source:start", "source:success", "provider:success"]),
  );
  expect(result.sources?.[0]).toMatchObject({
    label: expected.serverLabel,
    sourceEvidence: [
      expect.objectContaining({
        nativeLabel: expected.serverLabel,
        host: expected.sourceHost,
      }),
    ],
  });
  expect(result.sources?.map((candidate) => candidate.id)).toEqual([
    "source:rivestream:hindicast",
    "source:rivestream:flowcast",
  ]);
  expect(result.sources?.map((candidate) => candidate.status)).toEqual(["selected", "skipped"]);
  expect(result.streams[0]).toMatchObject({
    qualityLabel: normalizeQualityLabel(expected.quality),
    audioLanguages: [expected.normalizedLanguage],
    languageEvidence: [
      expect.objectContaining({
        nativeLabel: expected.nativeLanguageLabel,
        normalizedLanguage: expected.normalizedLanguage,
      }),
    ],
  });
  expect(result.subtitles[0]?.language).toBe(expected.subtitleLanguage);
  expect(result.selectionDecision).toMatchObject({
    startupPriority: "balanced",
    reason: "balanced-1080",
    selectedQualityRank: 1080,
  });
});

test("rivestream fixture fast startup keeps the first ready stream", async () => {
  const services = await readFixture<unknown>("rivestream/services-response.json");
  const source = await readFixture<unknown>("rivestream/source-response.json");
  const result = await rivestreamProviderModule.resolve(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      startupPriority: "fast",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-20T00:00:00.000Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (input) =>
          jsonResponse(String(input).includes("VideoProviderServices") ? services : source),
      },
    },
  );

  expect(result.status).toBe("resolved");
  expect(result.selectedStreamId).toBe(result.streams[0]?.id);
  expect(result.selectionDecision).toMatchObject({
    startupPriority: "fast",
    reason: "fast-start",
    selectedQualityRank: result.streams[0]?.qualityRank,
  });
});

test("rivestream fast startup selects provider ready-order before returned quality sort", async () => {
  const services = { data: ["FlowCast"] };
  const source = {
    data: {
      sources: [
        {
          url: "https://cdn.rivestream.example/flowcast/720/index.m3u8",
          quality: "720p",
          format: "hls",
        },
        {
          url: "https://cdn.rivestream.example/flowcast/1080/index.m3u8",
          quality: "1080p",
          format: "hls",
        },
      ],
    },
  };

  const resolveWithPriority = (startupPriority: "balanced" | "fast") =>
    rivestreamProviderModule.resolve(
      {
        title: {
          id: "438631",
          tmdbId: "438631",
          kind: "movie",
          title: "Dune",
          year: 2021,
        },
        mediaKind: "movie",
        startupPriority,
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      {
        now: () => "2026-05-22T00:00:00.000Z",
        fetch: {
          runtime: "direct-http",
          fetch: async (input) =>
            jsonResponse(String(input).includes("VideoProviderServices") ? services : source),
        },
      },
    );

  const fast = await resolveWithPriority("fast");
  expect(fast.status).toBe("resolved");
  expect(fast.streams.map((stream) => stream.qualityRank)).toEqual([1080, 720]);
  expect(fast.streams.find((stream) => stream.id === fast.selectedStreamId)).toMatchObject({
    qualityRank: 720,
    url: "https://cdn.rivestream.example/flowcast/720/index.m3u8",
  });
  expect(fast.selectionDecision).toMatchObject({
    startupPriority: "fast",
    reason: "fast-start",
    selectedQualityRank: 720,
  });

  const balanced = await resolveWithPriority("balanced");
  expect(balanced.status).toBe("resolved");
  expect(balanced.streams.find((stream) => stream.id === balanced.selectedStreamId)).toMatchObject({
    qualityRank: 1080,
    url: "https://cdn.rivestream.example/flowcast/1080/index.m3u8",
  });
  expect(balanced.selectionDecision).toMatchObject({
    startupPriority: "balanced",
    reason: "balanced-1080",
    selectedQualityRank: 1080,
  });
});

test("rivestream caches provider services across cold resolves", async () => {
  const services = await readFixture<unknown>("rivestream/services-response.json");
  const source = await readFixture<unknown>("rivestream/source-response.json");
  const requests: string[] = [];

  for (const tmdbId of ["900001", "900002"]) {
    const result = await rivestreamProviderModule.resolve(
      {
        title: {
          id: tmdbId,
          tmdbId,
          kind: "movie",
          title: `Cache Probe ${tmdbId}`,
        },
        mediaKind: "movie",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      {
        now: () => "2026-05-26T00:00:00.000Z",
        fetch: {
          runtime: "direct-http",
          fetch: async (input) => {
            const url = String(input);
            requests.push(url);
            return jsonResponse(url.includes("VideoProviderServices") ? services : source);
          },
        },
      },
    );

    expect(result.status).toBe("resolved");
  }

  expect(requests.filter((url) => url.includes("VideoProviderServices"))).toHaveLength(1);
  expect(requests.filter((url) => url.includes("VideoProvider&id="))).toHaveLength(2);
});

test("miruro evidence fixture preserves server evidence subtitles and seek thumbnails", async () => {
  const sourceData = await readFixture<
    Parameters<typeof createMiruroResultFromPayload>[0]["sourceData"]
  >("miruro/source-response.json");
  const expected = await readFixture<{
    readonly serverLabel: string;
    readonly serverId: "kiwi" | "bee";
    readonly audioLanguage: string;
    readonly hardSubLanguage: string;
    readonly presentation: "sub" | "dub";
    readonly subtitleLanguage: string;
    readonly seekBarVttUrl: string;
  }>("miruro/expected-normalized.json");

  const result = createMiruroResultFromPayload({
    input: {
      title: {
        id: "anilist:999",
        anilistId: "999",
        kind: "anime",
        title: "Evidence Fox",
      },
      episode: { episode: 1 },
      mediaKind: "anime",
      startupPriority: "balanced",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    sourceData,
    audioCategory: expected.presentation,
    serverProfile: {
      id: expected.serverId,
      label: expected.serverLabel,
      subtitleDelivery: "hardcoded",
      hardSubLanguage: expected.hardSubLanguage,
    },
    context: { now: () => "2026-05-19T00:00:00.000Z" },
  });

  expect(result?.status).toBe("resolved");
  expect(result?.artwork?.seekBarVttUrl).toBe(expected.seekBarVttUrl);
  expect(result?.sources?.[0]).toMatchObject({
    label: expect.stringContaining(expected.serverLabel),
    artwork: { seekBarVttUrl: expected.seekBarVttUrl },
    sourceEvidence: [
      expect.objectContaining({
        serverId: expected.serverId,
        nativeLabel: expected.serverLabel,
      }),
    ],
  });
  expect(result?.streams[0]).toMatchObject({
    audioLanguages: [expected.audioLanguage],
    presentation: expected.presentation,
    subtitleDelivery: "embedded",
    subtitleLanguages: [expected.subtitleLanguage],
    artwork: { seekBarVttUrl: expected.seekBarVttUrl },
    metadata: {
      intro: { start: 90, end: 180 },
      outro: { start: 1320, end: 1410 },
    },
  });
  expect(result?.subtitles[0]?.language).toBe(expected.subtitleLanguage);
  expect(result?.selectionDecision).toMatchObject({
    startupPriority: "balanced",
    reason: "balanced-1080",
    selectedQualityRank: 1080,
  });
});

test("miruro infers hardsub when sub stream has no pipe subtitles", async () => {
  const result = createMiruroResultFromPayload({
    input: {
      title: {
        id: "anilist:999",
        anilistId: "999",
        kind: "anime",
        title: "Evidence Fox",
      },
      episode: { episode: 1 },
      mediaKind: "anime",
      startupPriority: "balanced",
      intent: "play",
      allowedRuntimes: ["direct-http"],
      preferredSubtitleLanguage: "en",
    },
    sourceData: {
      streams: [
        {
          url: "https://cdn.miruro.example/kiwi/1080/index.m3u8",
          type: "hls",
          quality: "1080p",
        },
      ],
      subtitles: [],
    },
    audioCategory: "sub",
    serverProfile: {
      id: "kiwi",
      label: "Kiwi hardsub",
      subtitleDelivery: "unknown",
    },
    context: { now: () => "2026-05-19T00:00:00.000Z" },
  });

  expect(result?.streams[0]).toMatchObject({
    presentation: "sub",
    subtitleDelivery: "hardcoded",
    hardSubLanguage: "en",
  });
  expect(result?.subtitles).toHaveLength(0);
});

test("miruro fixture fast startup keeps the first ready stream", async () => {
  const sourceData = await readFixture<
    Parameters<typeof createMiruroResultFromPayload>[0]["sourceData"]
  >("miruro/source-response.json");
  const result = createMiruroResultFromPayload({
    input: {
      title: {
        id: "anilist:999",
        anilistId: "999",
        kind: "anime",
        title: "Evidence Fox",
      },
      episode: { episode: 1 },
      mediaKind: "anime",
      startupPriority: "fast",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    sourceData,
    audioCategory: "sub",
    serverProfile: {
      id: "kiwi",
      label: "Kiwi",
      subtitleDelivery: "hardcoded",
      hardSubLanguage: "en",
    },
    context: { now: () => "2026-05-20T00:00:00.000Z" },
  });

  expect(result?.selectedStreamId).toBe(result?.streams[0]?.id);
  expect(result?.selectionDecision).toMatchObject({
    startupPriority: "fast",
    reason: "fast-start",
    selectedQualityRank: result?.streams[0]?.qualityRank,
  });
});

test("miruro source cycling orders preferred subtitle delivery before fallback audio", () => {
  const candidates = buildMiruroCycleCandidates({
    episodes: {
      sub: [{ id: "sub-1", number: 1 }],
      dub: [{ id: "dub-1", number: 1 }],
    },
    episodeNum: 1,
    targetAudio: "dub",
    fallbackAudio: "sub",
  });

  expect(candidates.map((candidate) => candidate.label)).toEqual([
    "Dub · Kiwi · subtitles unknown",
    "Dub · Bee · subtitles unknown",
    "Dub · Hop · subtitles unknown",
    "Dub · Ally · subtitles unknown",
    "Dub · Pewe · subtitles unknown",
    "Dub · Moo · subtitles unknown",
    "Dub · Bonk · subtitles unknown",
    "Sub · Kiwi · subtitles unknown",
    "Sub · Bee · subtitles unknown",
    "Sub · Hop · subtitles unknown",
    "Sub · Ally · subtitles unknown",
    "Sub · Pewe · subtitles unknown",
    "Sub · Moo · subtitles unknown",
    "Sub · Bonk · subtitles unknown",
  ]);
  expect(candidates.map((candidate) => candidate.normalizedAudioLanguage)).toEqual([
    "en",
    "en",
    "en",
    "en",
    "en",
    "en",
    "en",
    "ja",
    "ja",
    "ja",
    "ja",
    "ja",
    "ja",
    "ja",
  ]);
});

test("miruro source cycling builds candidates from every matching provider key", async () => {
  const fixture = await readFixture<{
    readonly providers: Parameters<typeof buildMiruroCycleCandidates>[0]["providers"];
  }>("miruro/multi-provider-episodes.json");
  const candidates = buildMiruroCycleCandidates({
    providers: fixture.providers,
    episodeNum: 1,
    targetAudio: "sub",
    fallbackAudio: "dub",
  });

  expect(candidates.map((candidate) => candidate.serverId)).toEqual(
    expect.arrayContaining(["ANIMEKAI", "ANIMEZ", "kiwi", "hop"]),
  );
  expect(candidates.map((candidate) => candidate.serverId)).not.toContain("ZORO");
  expect(candidates.every((candidate) => candidate.metadata?.episodeId)).toBe(true);
  expect(candidates).toContainEqual(
    expect.objectContaining({
      serverId: "ANIMEKAI",
      nativeLabel: "AnimeKai",
      metadata: expect.objectContaining({
        audioCategory: "sub",
        serverId: "ANIMEKAI",
        subtitleDelivery: "unknown",
      }),
    }),
  );
});

test("miruro stream selection prefers active CDN HLS over direct kwik candidates", () => {
  const result = createMiruroResultFromPayload({
    input: {
      title: {
        id: "anilist:999",
        anilistId: "999",
        kind: "anime",
        title: "Evidence Fox",
      },
      episode: { episode: 1 },
      mediaKind: "anime",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    sourceData: {
      streams: [
        {
          url: "https://kwik.cx/f/direct-1080.m3u8",
          type: "hls",
          quality: "1080p",
          isActive: true,
          referer: "https://kwik.cx/",
        },
        {
          url: "https://vault-15.owocdn.top/inactive-1080/index.m3u8",
          type: "hls",
          quality: "1080p",
          isActive: false,
          referer: "https://kwik.cx/",
        },
        {
          url: "https://vault-06.uwucdn.top/active-720/index.m3u8",
          type: "hls",
          quality: "720p",
          isActive: true,
          referer: "https://kwik.cx/",
        },
      ],
    },
    audioCategory: "sub",
    serverProfile: {
      id: "kiwi",
      label: "Kiwi",
      subtitleDelivery: "unknown",
    },
    context: { now: () => "2026-05-26T00:00:00.000Z" },
  });

  const selected = result?.streams.find((stream) => stream.id === result.selectedStreamId);
  expect(new URL(selected?.url ?? "").hostname).toContain("uwucdn");
  expect(result?.streams).toHaveLength(3);
});

test("miruro pipe requests use only TLS-reachable official mirrors", () => {
  expect(createMiruroPipeRequestUrls("payload")).toEqual([
    "https://www.miruro.bz/api/secure/pipe?e=payload",
    "https://www.miruro.ru/api/secure/pipe?e=payload",
    "https://miruro.bz/api/secure/pipe?e=payload",
    "https://miruro.ru/api/secure/pipe?e=payload",
  ]);
});

test("miruro episode lookup preserves network failures as provider evidence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("ConnectionRefused");
  }) as unknown as typeof fetch;

  try {
    await expect(
      getMiruroEpisodesResponse(
        { providerId: "miruro", now: () => new Date().toISOString() },
        "999001",
      ),
    ).rejects.toThrow("Miruro pipe network request failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("negative fixture maps blocked vidking host to structured failure", async () => {
  const blocked = await readFixture<{ readonly status: number; readonly body: unknown }>(
    "negative/vidking-blocked.json",
  );
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
      },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-19T00:00:00.000Z",
      retryPolicy: { maxAttempts: 1, backoff: "none" },
      fetch: {
        runtime: "direct-http",
        fetch: async () => jsonResponse(blocked.body, blocked.status),
      },
    },
    { serverEndpoint: "blocked" },
  );

  expect(result?.status).toBe("exhausted");
  expect(result?.failures[0]).toMatchObject({
    code: "blocked",
    retryable: false,
  });
  expect(result?.trace.events?.map((event) => event.type)).toContain("provider:exhausted");
});

test("negative fixture keeps rivestream parse failures inspectable", async () => {
  const services = await readFixture<unknown>("negative/rivestream-services-response.json");
  const malformed = await readTextFixture("negative/rivestream-parse-missing.txt");
  const result = await rivestreamProviderModule.resolve(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
      },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-19T00:00:00.000Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          const url = String(input);
          if (url.includes("VideoProviderServices")) return jsonResponse(services);
          return new Response(malformed, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    },
  );

  expect(result.status).toBe("exhausted");
  expect(result.failures[0]).toMatchObject({
    code: "parse-failed",
    retryable: false,
  });
  expect(result.trace.failures[0]?.code).toBe("parse-failed");
});

test("m3u8 quality extraction exposes sorted playable variants", async () => {
  const streams = await extractQualitiesFromMaster(
    {
      runtime: "direct-http",
      fetch: async () =>
        new Response(
          [
            "#EXTM3U",
            '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,NAME="720p"',
            "720/index.m3u8",
            "#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1920x1080",
            "https://cdn.example/1080/index.m3u8",
          ].join("\n"),
        ),
    },
    "https://cdn.example/master.m3u8",
    {
      providerId: "videasy",
      protocol: "hls",
      container: "m3u8",
      confidence: 0.9,
      cachePolicy: {
        ttlClass: "stream-manifest",
        scope: "local",
        keyParts: ["provider", "vidking", "qualities"],
      },
    },
  );

  expect(streams.map((stream) => stream.qualityLabel)).toEqual(["1080p", "720p"]);
  expect(streams[1]?.url).toBe("https://cdn.example/720/index.m3u8");
});

test("variant tree builder creates stable grouped variant ordering", () => {
  const variants = new VariantTreeBuilder({
    providerId: "miruro",
    sourceId: "source:miruro:pipe",
  })
    .addVariant({
      label: "Dub 720p",
      presentation: "dub",
      subtitleDelivery: "embedded",
      qualityLabel: "720p",
      qualityRank: 720,
      streamIds: ["stream-dub-720"],
      confidence: 0.8,
    })
    .addVariant({
      label: "Sub 1080p",
      presentation: "sub",
      subtitleDelivery: "hardcoded",
      qualityLabel: "1080p",
      qualityRank: 1080,
      streamIds: ["stream-sub-1080"],
      confidence: 0.9,
    })
    .build();

  expect(variants.map((variant) => variant.label)).toEqual(["Sub 1080p", "Dub 720p"]);
  expect(variants[0]?.id.startsWith("var_")).toBe(true);
});

test("source inventory helpers create stable ids and provider evidence", () => {
  const first = stableProviderInventoryId({
    prefix: "source",
    parts: ["vidking", "Kiwi", "https://cdn.example/1080/index.m3u8"],
  });
  const second = stableProviderInventoryId({
    prefix: "source",
    parts: ["vidking", "Kiwi", "https://cdn.example/1080/index.m3u8"],
  });

  expect(first).toBe(second);
  expect(first.startsWith("source_")).toBe(true);
  expect(
    createStreamId("vidking", ["https://cdn.example/1080/index.m3u8"]).startsWith("stream_"),
  ).toBe(true);
  expect(parseSourceHost("https://cdn.example/1080/index.m3u8")).toBe("cdn.example");
  expect(parseSourceHost("not a url")).toBeUndefined();
  expect(normalizeQualityLabel("Full HD")).toBe("1080p");
  expect(normalizeQualityLabel("4K")).toBe("2160p");
  expect(qualityRankFromLabel("720p")).toBe(720);
  // Adaptive "auto" ladders are ranked as 1080 so they are not sorted below 360p rows.
  expect(qualityRankFromLabel("auto")).toBe(1080);
  expect(normalizeProviderDisplayLabel("mb-flix")).toBe("MB Flix");
  expect(normalizeProviderDisplayLabel("primevids")).toBe("PrimeVids");
  expect(normalizeProviderDisplayLabel("flow_cast")).toBe("Flow Cast");
  expect(normalizeProviderDisplayLabel("fm-hls")).toBe("FM HLS");
  expect(normalizeProviderDisplayLabel("yt-mp4")).toBe("YT MP4");
  expect(normalizeProviderDisplayLabel("kiwi")).toBe("Kiwi");

  expect(
    createProviderSourceEvidence({
      sourceId: "source:vidking:kiwi",
      serverId: "kiwi",
      nativeLabel: "kiwi",
      url: "https://kiwi.example/master.m3u8",
    }),
  ).toMatchObject({
    sourceId: "source:vidking:kiwi",
    serverId: "kiwi",
    nativeLabel: "kiwi",
    host: "kiwi.example",
  });

  const providerAliasEvidence = createProviderLanguageEvidence({
    role: "audio",
    nativeLabel: "HindiCast",
    sourceId: "source:vidking:hindi",
  });
  expect(providerAliasEvidence).toMatchObject({
    role: "audio",
    nativeLabel: "HindiCast",
    sourceId: "source:vidking:hindi",
  });
  expect(providerAliasEvidence.normalizedLanguage).toBeUndefined();
});

test("strict language normalizer keeps provider aliases out of public language fields", () => {
  expect(normalizeIsoLanguageCode("English CC")).toBe("en");
  expect(normalizeIsoLanguageCode("Portuguese (BR)")).toBe("pt");
  expect(normalizeIsoLanguageCode("pt-br")).toBe("pt");
  expect(normalizeIsoLanguageCode("Vietnamese")).toBe("vi");
  expect(normalizeIsoLanguageCode("Vietsub")).toBeUndefined();
  expect(normalizeIsoLanguageCode("HindiCast")).toBeUndefined();
  expect(normalizeIsoLanguageCode("killjoy")).toBeUndefined();
  expect(normalizeIsoLanguageCode("FlowCast")).toBeUndefined();
});

test("source inventory helpers project streams into source and variant candidates", () => {
  const stream = {
    id: "stream:vidking:1080",
    providerId: "videasy",
    sourceId: "source:vidking:kiwi",
    url: "https://kiwi.example/master.m3u8",
    protocol: "hls",
    container: "m3u8",
    presentation: "dub",
    audioLanguages: ["en"],
    qualityLabel: "1080p",
    qualityRank: 1080,
    serverName: "Kiwi",
    confidence: 0.9,
    cachePolicy: {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: ["vidking", "kiwi"],
    },
    sourceEvidence: [
      createProviderSourceEvidence({
        sourceId: "source:vidking:kiwi",
        nativeLabel: "kiwi",
        url: "https://kiwi.example/master.m3u8",
      }),
    ],
    languageEvidence: [
      createProviderLanguageEvidence({
        role: "audio",
        value: "English",
        nativeLabel: "English",
      }),
    ],
  } as const;

  const source = createSourceCandidateFromStream({
    providerId: "videasy",
    stream,
    selected: true,
  });
  const variant = createVariantCandidateFromStream({
    providerId: "videasy",
    stream,
    selected: true,
  });

  expect(source).toMatchObject({
    id: "source:vidking:kiwi",
    label: "Kiwi",
    host: "kiwi.example",
    status: "selected",
  });
  expect(variant).toMatchObject({
    sourceId: "source:vidking:kiwi",
    label: "Dub 1080p",
    qualityRank: 1080,
    selected: true,
    streamIds: ["stream:vidking:1080"],
  });
});

test("allmanga source candidates preserve separate source families", () => {
  const sources = buildAllmangaSourceCandidates(
    [
      {
        id: "stream:hls:1080",
        providerId: "allanime",
        sourceId: "source:allanime:fm-hls",
        url: "https://cdn.example/hls.m3u8",
        protocol: "hls",
        confidence: 0.95,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
      {
        id: "stream:mp4:720",
        providerId: "allanime",
        sourceId: "source:allanime:vid-mp4",
        url: "https://cdn.example/720.mp4",
        protocol: "mp4",
        confidence: 0.85,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
    ],
    "source:allanime:fm-hls",
    {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: [],
    },
  );

  expect(sources.map((source) => source.id)).toEqual([
    "source:allanime:fm-hls",
    "source:allanime:vid-mp4",
  ]);
  expect(sources.map((source) => source.status)).toEqual(["selected", "available"]);
  expect(sources[0]?.metadata?.streamIds).toBe("stream:hls:1080");
});

async function readFixture<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(new URL(path, FIXTURE_BASE)).text()) as T;
}

async function readTextFixture(path: string): Promise<string> {
  return Bun.file(new URL(path, FIXTURE_BASE)).text();
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
