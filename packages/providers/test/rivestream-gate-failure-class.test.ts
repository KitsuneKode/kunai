import { describe, expect, test } from "bun:test";

import type { EndpointHealthPort, ProviderRuntimeContext } from "@kunai/types";

import { rivestreamProviderModule } from "../src/rivestream/direct";

/**
 * A resolve-gate rejection has to survive the candidate's own error handling.
 *
 * The gate throws a `ProviderCycleFailureError` carrying `candidate-blocked`
 * and `endpointScoped`. The catch around the candidate wrapped *every* error
 * into a `ProviderHttpError` and rebuilt the cycle failure from it, which
 * relabelled the gate's verdict as `candidate-empty` and dropped the scoped
 * flag — so endpoint health recorded nothing and every later resolve re-walked
 * the same dead mirror.
 *
 * It also made the two indistinguishable in a trace: "this server returned no
 * sources" and "this server's stream is refused" both read as `candidate-empty`.
 */
const SERVICES = { data: ["primevids", "citadel"] };

const SOURCE_RESPONSE = {
  data: {
    sources: [{ url: "https://dead.example/hls/index.m3u8", quality: "1080" }],
    captions: [],
  },
};

function contextWithDeadCdn(
  recorded: { endpoint: string; class: string }[],
): ProviderRuntimeContext {
  const endpointHealth: EndpointHealthPort = {
    shouldTry: () => true,
    recordFailure: (_providerId, endpoint, info) => recorded.push({ endpoint, class: info.class }),
    recordSuccess: () => {},
  };

  return {
    now: () => "2026-09-09T00:00:00.000Z",
    signal: AbortSignal.timeout(30_000),
    endpointHealth,
    fetch: {
      runtime: "direct-http" as const,
      fetch: async (input: string) => {
        const url = String(input);
        if (url.includes("VideoProviderServices")) {
          return new Response(JSON.stringify(SERVICES), { status: 200 });
        }
        if (url.includes("backendfetch")) {
          return new Response(JSON.stringify(SOURCE_RESPONSE), { status: 200 });
        }
        if (url.includes(".m3u8")) {
          return new Response("#EXTM3U\n#EXTINF:4.0,\nsegment-0.ts\n", { status: 200 });
        }
        // The segment is refused outright — a proven-dead stream.
        return new Response("domain forbidden", { status: 403 });
      },
    },
    emit: () => {},
  } as unknown as ProviderRuntimeContext;
}

describe("rivestream resolve-gate failure class", () => {
  test("a refused stream is reported as blocked, not as an empty candidate", async () => {
    const recorded: { endpoint: string; class: string }[] = [];
    const result = await rivestreamProviderModule.resolve(
      {
        title: { id: "1396", tmdbId: "1396", kind: "series", title: "Breaking Bad" },
        episode: { season: 1, episode: 1 },
        mediaKind: "series",
        startupPriority: "balanced",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      contextWithDeadCdn(recorded),
    );

    const classes = (result.trace.events ?? [])
      .filter((event) => event.type === "source:failed")
      .map((event) => String(event.attributes?.failureClass ?? ""));

    expect(classes.length).toBeGreaterThan(0);
    expect(classes.every((failureClass) => failureClass === "candidate-blocked")).toBe(true);
    expect(classes).not.toContain("candidate-empty");
  });

  test("the refusal reaches endpoint health so the mirror is not re-walked", async () => {
    const recorded: { endpoint: string; class: string }[] = [];
    await rivestreamProviderModule.resolve(
      {
        title: { id: "1396", tmdbId: "1396", kind: "series", title: "Breaking Bad" },
        episode: { season: 1, episode: 1 },
        mediaKind: "series",
        startupPriority: "balanced",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      contextWithDeadCdn(recorded),
    );

    expect(recorded).toContainEqual({ endpoint: "primevids", class: "server-error" });
  });
});
