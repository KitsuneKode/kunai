import { describe, expect, test } from "bun:test";

import type { EndpointHealthPort, ProviderRuntimeContext } from "@kunai/types";

import { videasyProviderModule } from "../src/videasy/direct";
import { isVidkingSourceDeprecated } from "../src/videasy/flavors";

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

const passthroughEndpointHealth: EndpointHealthPort = {
  shouldTry: () => true,
  recordFailure: () => {},
  recordSuccess: () => {},
};

describe("videasy preferred source fallback", () => {
  test("deprecated Sanji source id is recognized", () => {
    expect(isVidkingSourceDeprecated("source:videasy:1movies")).toBe(true);
    expect(isVidkingSourceDeprecated("source:videasy:mb-flix")).toBe(false);
  });

  test("deprecated preferred source falls back to Phase A mirrors", async () => {
    const requestedUrls: string[] = [];
    const context = {
      now: () => "2026-07-11T00:00:00.000Z",
      signal: AbortSignal.timeout(30_000),
      retryPolicy: { maxAttempts: 1, backoff: "none" as const },
      // Isolate from module-level HealthTracker pollution left by other Videasy tests.
      endpointHealth: passthroughEndpointHealth,
      fetch: {
        runtime: "direct-http" as const,
        fetch: async (input) => {
          requestedUrls.push(String(input));
          return new Response("", { status: 404 });
        },
      },
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
    const endpoints = videasyStreamUrls(requestedUrls).map(
      (url) => new URL(url).pathname.split("/")[1] ?? "",
    );
    expect(endpoints.includes("1movies")).toBe(false);
    expect(endpoints.includes("mb-flix")).toBe(true);
    expect(endpoints.includes("cdn")).toBe(true);
    expect(endpoints.includes("downloader2")).toBe(true);
  });
});
