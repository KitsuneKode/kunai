import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ProviderCycleFailure, ProviderRuntimeContext } from "@kunai/types";

import {
  buildRivestreamCycleCandidates,
  clearRivestreamCachesForTest,
  rivestreamProviderModule,
  shouldStopRivestreamWalk,
} from "../src/rivestream/direct";

function failure(
  failureClass: ProviderCycleFailure["failureClass"],
  endpointScoped = false,
): ProviderCycleFailure {
  return {
    providerId: "rivestream",
    candidateId: "candidate",
    failureClass,
    message: failureClass,
    retryable: true,
    at: "2026-11-17T00:00:00.000Z",
    endpointScoped,
  };
}

describe("shouldStopRivestreamWalk", () => {
  test("an unmarked candidate-timeout does not end the walk", () => {
    // The cycle timer uses this class for a slow CDN probe. Only a failure
    // marked when GET /api/provider itself times out stops the walk.
    expect(shouldStopRivestreamWalk(failure("candidate-timeout"))).toBe(false);
  });

  test("an unscoped block ends the walk; an endpoint-scoped one does not", () => {
    expect(shouldStopRivestreamWalk(failure("candidate-blocked"))).toBe(true);
    expect(shouldStopRivestreamWalk(failure("candidate-blocked", true))).toBe(false);
  });

  test("an empty or unparsable service keeps walking", () => {
    expect(shouldStopRivestreamWalk(failure("candidate-empty"))).toBe(false);
    expect(shouldStopRivestreamWalk(failure("candidate-parse"))).toBe(false);
  });
});

describe("rivestream prefetch order", () => {
  beforeEach(() => {
    clearRivestreamCachesForTest();
  });
  afterEach(() => {
    clearRivestreamCachesForTest();
  });

  test("a pinned source is the one prefetched, so it is not requested twice in parallel", async () => {
    const services = ["citadel", "apollo"];
    const pinned = buildRivestreamCycleCandidates(services, undefined, undefined).find(
      (candidate) => candidate.serverId === "apollo",
    );
    if (!pinned?.sourceId) throw new Error("apollo must produce a pinnable source id");

    const requestedServices: string[] = [];
    const context: ProviderRuntimeContext = {
      now: () => "2026-11-17T00:00:00.000Z",
      signal: new AbortController().signal,
      emit: () => {},
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          const url = String(input);
          if (url.includes("/api/providers")) {
            return Response.json({ data: services });
          }
          if (url.includes("/api/provider?")) {
            requestedServices.push(new URL(url).searchParams.get("provider") ?? "");
            return Response.json({
              data: {
                sources: [{ url: "https://cdn.example/video.mp4", quality: "1080" }],
                captions: [],
              },
            });
          }
          return new Response("ok", { status: 200 });
        },
      },
    };

    const resolve = rivestreamProviderModule.resolve;
    if (!resolve) throw new Error("rivestream module must expose resolve");
    const result = await resolve(
      {
        title: { id: "1396", tmdbId: "1396", kind: "series", title: "Breaking Bad" },
        episode: { season: 1, episode: 1 },
        mediaKind: "series",
        startupPriority: "balanced",
        intent: "play",
        allowedRuntimes: ["direct-http"],
        preferredSourceId: pinned.sourceId,
      },
      context,
    );

    expect(result.status).toBe("resolved");
    expect(requestedServices).toEqual(["apollo"]);
  });
});
