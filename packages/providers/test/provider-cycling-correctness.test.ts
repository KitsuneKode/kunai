import { describe, expect, test } from "bun:test";

import type {
  EndpointHealthPort,
  ProviderResolveInput,
  ProviderRuntimeContext,
} from "@kunai/types";

import {
  createMiruroPipeRequestUrls,
  MIRURO_PIPE_BASE_URLS,
  MIRURO_WAF_FAIL_FAST_THRESHOLD,
} from "../src/miruro/direct";
import { rivestreamProviderModule } from "../src/rivestream/direct";

const SERVICES = ["deadmirror", "goodmirror"] as const;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function buildFetch(requested: string[]): ProviderRuntimeContext["fetch"] {
  return {
    runtime: "direct-http",
    fetch: (async (url: string | URL | Request) => {
      const href = String(url);
      requested.push(href);
      if (href.includes("requestID=VideoProviderServices")) {
        return jsonResponse({ data: [...SERVICES] });
      }
      if (href.includes("service=deadmirror")) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({
        data: [{ url: "https://cdn.example/goodmirror/1080/index.m3u8", quality: "1080" }],
      });
    }) as NonNullable<ProviderRuntimeContext["fetch"]>["fetch"],
  } as ProviderRuntimeContext["fetch"];
}

function buildInput(): ProviderResolveInput {
  return {
    mediaKind: "movie",
    title: { id: "tmdb:27205", title: "Inception", tmdbId: 27205 },
    allowedRuntimes: ["direct-http"],
    qualityPreference: "best",
    startupPriority: "balanced",
  } as unknown as ProviderResolveInput;
}

function buildContext(
  endpointHealth: EndpointHealthPort,
  requested: string[],
): ProviderRuntimeContext {
  return {
    providerId: "rivestream",
    now: () => new Date().toISOString(),
    fetch: buildFetch(requested),
    endpointHealth,
  } as unknown as ProviderRuntimeContext;
}

describe("provider cycling correctness", () => {
  test("miruro fail-fast budget tracks the mirror list instead of a hardcoded 2", async () => {
    // One pipe URL per base, and the fail-fast threshold equals the mirror
    // count: adding a mirror raises the budget automatically, or the cycle
    // aborts with healthy mirrors untried.
    expect(createMiruroPipeRequestUrls("probe").length).toBe(MIRURO_PIPE_BASE_URLS.length);
    expect(MIRURO_WAF_FAIL_FAST_THRESHOLD).toBe(MIRURO_PIPE_BASE_URLS.length);
  });

  test("rivestream consults endpoint health and skips a quarantined mirror", async () => {
    const { resolve: resolveStream } = rivestreamProviderModule;
    if (!resolveStream) throw new Error("rivestream module must expose resolve");

    const seen: string[] = [];
    const successes: string[] = [];
    const requested: string[] = [];
    const endpointHealth: EndpointHealthPort = {
      shouldTry: (_providerId, endpoint) => {
        seen.push(endpoint);
        return endpoint !== "deadmirror";
      },
      recordSuccess: (_providerId, endpoint) => {
        successes.push(endpoint);
      },
      recordFailure: () => {},
    };

    const result = await resolveStream(buildInput(), buildContext(endpointHealth, requested));
    expect(result.status).toBe("resolved");
    // Health was consulted for both mirrors, but the quarantined one was never
    // asked over HTTP: no prefetch, no source fetch — the cycle skipped it.
    expect(seen).toContain("deadmirror");
    expect(requested.some((href) => href.includes("service=deadmirror"))).toBe(false);
    expect(successes).toEqual(["goodmirror"]);
    const events = result.trace?.events ?? [];
    expect(
      events.some(
        (event) => event.type === "source:skipped" && event.attributes?.endpoint === "deadmirror",
      ),
    ).toBe(true);
  });

  test("rivestream records nothing for a mirror that simply lacks the title", async () => {
    const { resolve: resolveStream } = rivestreamProviderModule;
    if (!resolveStream) throw new Error("rivestream module must expose resolve");

    const recorded: string[] = [];
    const endpointHealth: EndpointHealthPort = {
      // Quarantine nothing: both mirrors are tried in order.
      shouldTry: () => true,
      recordSuccess: () => {},
      recordFailure: (_providerId, endpoint) => {
        recorded.push(endpoint);
      },
    };

    const result = await resolveStream(buildInput(), buildContext(endpointHealth, []));
    expect(result.status).toBe("resolved");
    // `candidate-empty` is not endpoint evidence: a mirror lacking one title
    // must not be quarantined for every other title.
    expect(recorded).not.toContain("deadmirror");
  });
});
