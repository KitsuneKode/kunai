import { describe, expect, test } from "bun:test";

import type { EndpointHealthPort, ProviderRuntimeContext } from "@kunai/types";

import { videasyProviderModule } from "../src/videasy/direct";
import { flavorSourceId, isVidkingSourceDeprecated } from "../src/videasy/flavors";

/** Keep enrich (TMDB proxy) requests out of stream-route assertions. */
function videasyStreamUrls(urls: readonly string[]): string[] {
  return urls.filter((url) => {
    try {
      return new URL(url).pathname.includes("sources-with-title");
    } catch {
      return false;
    }
  });
}

function createFetchWithSeedMock(sourceHandler: (input: string) => Response | Promise<Response>) {
  return {
    runtime: "direct-http" as const,
    fetch: async (input: string) => {
      if (input.includes("/seed?")) {
        return new Response(JSON.stringify({ seed: "test-seed.vAlIdS33dString", ttlMs: 30000 }));
      }
      return sourceHandler(input);
    },
  };
}

const passthroughEndpointHealth: EndpointHealthPort = {
  shouldTry: () => true,
  recordFailure: () => {},
  recordSuccess: () => {},
};

describe("videasy preferred source fallback", () => {
  test("keeps a Wings fallback seed and encrypted source request on the same host", async () => {
    const requestedUrls: string[] = [];
    const context = {
      now: () => "2026-07-16T00:00:00.000Z",
      signal: AbortSignal.timeout(30_000),
      retryPolicy: { maxAttempts: 1, backoff: "none" as const },
      endpointHealth: passthroughEndpointHealth,
      fetch: {
        runtime: "direct-http" as const,
        fetch: async (input: string) => {
          const url = String(input);
          requestedUrls.push(url);
          if (url === "https://api.speedracelight.com/seed?mediaId=987654") {
            return new Response("", { status: 503 });
          }
          if (url === "https://api.wingsdatabase.com/seed?mediaId=987654") {
            return new Response(
              JSON.stringify({ seed: "test-seed.vAlIdS33dString", ttlMs: 30_000 }),
            );
          }
          return new Response("", { status: 404 });
        },
      },
      emit: () => {},
    } satisfies ProviderRuntimeContext;

    await videasyProviderModule.resolve(
      {
        title: { id: "987654", tmdbId: "987654", title: "Fallback Host", kind: "movie" },
        mediaKind: "movie",
        allowedRuntimes: ["direct-http"],
        startupPriority: "balanced",
        preferredSourceId: flavorSourceId("cineby-neon"),
        intent: "play",
      },
      context,
    );

    const sourceRequests = videasyStreamUrls(requestedUrls).filter((url) =>
      new URL(url).pathname.startsWith("/neon2/"),
    );
    expect(sourceRequests.length).toBeGreaterThan(0);
    expect(sourceRequests.every((url) => new URL(url).host === "api.wingsdatabase.com")).toBe(true);
  });

  test("deprecated Helium/1movies source id is recognized; legacy Videasy endpoints also deprecated", () => {
    expect(isVidkingSourceDeprecated("source:videasy:1movies")).toBe(true);
    expect(isVidkingSourceDeprecated("source:videasy:mb-flix")).toBe(true);
    expect(isVidkingSourceDeprecated("source:videasy:meine")).toBe(true);
  });

  test("deprecated preferred source falls back to Phase A wings-* mirrors", async () => {
    const requestedUrls: string[] = [];
    const context = {
      now: () => "2026-07-11T00:00:00.000Z",
      signal: AbortSignal.timeout(30_000),
      retryPolicy: { maxAttempts: 1, backoff: "none" as const },
      // Isolate from module-level HealthTracker pollution left by other Videasy tests.
      endpointHealth: passthroughEndpointHealth,
      fetch: createFetchWithSeedMock(async (input) => {
        requestedUrls.push(String(input));
        return new Response("", { status: 404 });
      }),
      emit: () => {},
    } satisfies ProviderRuntimeContext;

    const result = await videasyProviderModule.resolve(
      {
        title: { id: "248244", title: "Undercover High School", tmdbId: "248244", kind: "series" },
        mediaKind: "series",
        episode: { season: 1, episode: 4 },
        allowedRuntimes: ["direct-http"],
        startupPriority: "balanced",
        preferredSourceId: "source:videasy:1movies",
        intent: "play",
      },
      context,
    );

    // Upstream is route-dead in fixtures; assert routing, not a live stream.
    expect(result.status).toBe("exhausted");
    const endpointSet = new Set(
      videasyStreamUrls(requestedUrls).map((url) => new URL(url).pathname.split("/")[1] ?? ""),
    );
    // 1movies is deprecated, not in phase A
    expect(endpointSet.has("1movies")).toBe(false);
    // Phase A resolve order is Neon/Cypher-first; inventory still shows Yoru first in UI.
    expect(endpointSet.has("neon2")).toBe(true);
    expect(endpointSet.has("downloader2")).toBe(true);
    expect(endpointSet.has("cdn")).toBe(true);
    expect(endpointSet.has("tejo")).toBe(false);
  });
});
