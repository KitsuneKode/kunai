import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  buildRivestreamCycleCandidates,
  clearRivestreamCachesForTest,
  demoteRivestreamDeadBackends,
  isRivestreamDemotedBackend,
  RIVESTREAM_DEMOTED_BACKENDS,
  RIVESTREAM_STATIC_PROVIDER_SERVICES,
  rivestreamProviderModule,
} from "../src/rivestream/direct";

// Live discovery as returned by rivestream.app on 2026-10-14 (Breaking Bad
// S01E01 smoke): apogee/vanguard 403, mirage→solstice empty, primevids 403,
// citadel working.
const LIVE_SERVICES = [
  "apogee",
  "vanguard",
  "mirage",
  "velocity",
  "ignite",
  "tampa",
  "meridian",
  "savannah",
  "prometheus",
  "quasar",
  "solstice",
  "primevids",
  "citadel",
  "apollo",
  "asiacloud",
];

describe("rivestream dead-backend prune", () => {
  test("demoted backends trail the walk in discovery order", () => {
    expect(demoteRivestreamDeadBackends(LIVE_SERVICES)).toEqual([
      "apogee",
      "vanguard",
      "mirage",
      "velocity",
      "ignite",
      "tampa",
      "meridian",
      "citadel",
      "apollo",
      "asiacloud",
      "savannah",
      "prometheus",
      "quasar",
      "solstice",
      "primevids",
    ]);
  });

  test("nothing is dropped — a recovered mirror still resolves as last resort", () => {
    const demoted = demoteRivestreamDeadBackends(LIVE_SERVICES);
    expect([...demoted].sort()).toEqual([...LIVE_SERVICES].sort());
  });

  test("a list with no dead backends keeps its order", () => {
    const healthy = ["citadel", "apollo", "asiacloud"];
    expect(demoteRivestreamDeadBackends(healthy)).toEqual(healthy);
  });

  test("empty stays empty", () => {
    expect(demoteRivestreamDeadBackends([])).toEqual([]);
  });

  test("matching is case-insensitive; discovery casing is upstream-controlled", () => {
    expect(isRivestreamDemotedBackend("PrimeVids")).toBe(true);
    expect(isRivestreamDemotedBackend("CITADEL")).toBe(false);
    expect(demoteRivestreamDeadBackends(["citadel", "PrimeVids"])).toEqual([
      "citadel",
      "PrimeVids",
    ]);
  });

  test("an explicitly pinned demoted source still outranks the order", () => {
    const providers = demoteRivestreamDeadBackends(["citadel", "primevids"]);
    const pinned = buildRivestreamCycleCandidates(providers, undefined, undefined).find(
      (candidate) => candidate.serverId === "primevids",
    );
    const order = [...buildRivestreamCycleCandidates(providers, pinned?.sourceId, undefined)]
      .sort((a, b) => a.priority - b.priority)
      .map((candidate) => String(candidate.serverId));
    expect(order[0]).toBe("primevids");
  });

  test("the static fallback carries no demoted backend", () => {
    for (const service of RIVESTREAM_STATIC_PROVIDER_SERVICES) {
      expect(RIVESTREAM_DEMOTED_BACKENDS.has(service.toLowerCase())).toBe(false);
    }
    // The working fallback the prune must not remove.
    expect(RIVESTREAM_STATIC_PROVIDER_SERVICES).toContain("citadel");
  });
});

describe("rivestream demoted-backend prefetch", () => {
  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  beforeEach(() => {
    clearRivestreamCachesForTest();
  });
  afterEach(() => {
    clearRivestreamCachesForTest();
  });

  test("a working mirror ahead of demoted backends costs them zero requests", async () => {
    const requestedServices: string[] = [];
    const context: ProviderRuntimeContext = {
      now: () => "2026-10-14T00:00:00.000Z",
      signal: AbortSignal.timeout(30_000),
      emit: () => {},
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          const url = String(input);
          if (url.includes("VideoProviderServices")) {
            return jsonResponse({ data: ["citadel", "savannah", "primevids"] });
          }
          if (url.includes("backendfetch")) {
            requestedServices.push(new URL(url).searchParams.get("service") ?? "");
            if (url.includes("service=citadel")) {
              return jsonResponse({
                data: {
                  sources: [{ url: "https://cdn.example/video.mp4", quality: "1080" }],
                  captions: [],
                },
              });
            }
            return jsonResponse({ data: { sources: [], captions: [] } });
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
      },
      context,
    );

    expect(result.status).toBe("resolved");
    // Citadel is prefetched and wins; the demoted mirrors behind it are never
    // fetched — not by prefetch, and not by the cycle, which stops at success.
    expect(requestedServices).toEqual(["citadel"]);
    expect(
      (result.trace.events ?? []).some((event) =>
        event.message.includes("Demoted dead backends trail the cycle"),
      ),
    ).toBe(true);
  });
});
