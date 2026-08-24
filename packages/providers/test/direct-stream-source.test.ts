import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { resolveDirectStreamSource } from "../src/shared/direct-stream-source";

function createContext(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): ProviderRuntimeContext {
  return {
    providerId: "vidlink",
    now: () => new Date().toISOString(),
    signal,
    fetch: { runtime: "direct-http", fetch: fetchImpl },
  } as unknown as ProviderRuntimeContext;
}

function createInput(overrides: Partial<ProviderResolveInput> = {}): ProviderResolveInput {
  return {
    mediaKind: "movie",
    title: { id: "tmdb:27205", title: "Inception", externalIds: { tmdbId: 27205 } },
    allowedRuntimes: ["direct-http"],
    qualityPreference: "best",
    startupPriority: "balanced",
    ...overrides,
  } as ProviderResolveInput;
}

const THREE_STREAMS = {
  streams: [
    { url: "https://cdn.example/1080.mp4", qualityHint: "1080p" },
    { url: "https://cdn.example/720.mp4", qualityHint: "720p" },
    { url: "https://cdn.example/480.mp4", qualityHint: "480p" },
  ],
};

describe("direct stream resolve gate", () => {
  test("falls back to a lower-ranked stream when the top candidate is unreachable", async () => {
    const probed: string[] = [];
    const result = await resolveDirectStreamSource({
      providerId: "vidlink",
      host: "vidlink.pro",
      label: "VidLink",
      input: createInput(),
      context: createContext(async (url) => {
        probed.push(url);
        return url.includes("1080") ? new Response("gone", { status: 404 }) : new Response("ok");
      }),
      fetchPayload: async () => THREE_STREAMS,
      resolveGateProbe: true,
    });

    expect(result.status).toBe("resolved");
    expect(probed.some((url) => url.includes("1080"))).toBe(true);
    expect(result.streams?.[0]).toBeDefined();
    // The 720p sibling is alive, so the provider must not be condemned.
    expect(result.selectedStreamId).toBeTruthy();
  });

  test("a rate-limited CDN blocks, because its streams do not play either", async () => {
    const result = await resolveDirectStreamSource({
      providerId: "vidlink",
      host: "vidlink.pro",
      label: "VidLink",
      input: createInput(),
      context: createContext(async () => new Response("slow down", { status: 429 })),
      fetchPayload: async () => THREE_STREAMS,
      resolveGateProbe: true,
    });

    // Falling back to a working provider beats handing mpv an error page.
    expect(result.status).toBe("exhausted");
  });

  test("exhausts only when every probed candidate is definitively unreachable", async () => {
    const result = await resolveDirectStreamSource({
      providerId: "vidlink",
      host: "vidlink.pro",
      label: "VidLink",
      input: createInput(),
      context: createContext(async () => new Response("gone", { status: 404 })),
      fetchPayload: async () => THREE_STREAMS,
      resolveGateProbe: true,
    });

    expect(result.status).toBe("exhausted");
  });

  test("caps the probe walk instead of paying for every candidate", async () => {
    let probes = 0;
    await resolveDirectStreamSource({
      providerId: "vidlink",
      host: "vidlink.pro",
      label: "VidLink",
      input: createInput(),
      context: createContext(async () => {
        probes += 1;
        return new Response("gone", { status: 404 });
      }),
      fetchPayload: async () => ({
        streams: Array.from({ length: 10 }, (_, i) => ({
          url: `https://cdn.example/${i}.mp4`,
          qualityHint: "720p",
        })),
      }),
      resolveGateProbe: true,
    });

    expect(probes).toBeLessThanOrEqual(3);
  });

  test("a cancelled resolve stops probing and does not hand back a stream", async () => {
    const controller = new AbortController();
    let probes = 0;
    controller.abort();

    const result = await resolveDirectStreamSource({
      providerId: "vidlink",
      host: "vidlink.pro",
      label: "VidLink",
      input: createInput(),
      context: createContext(async () => {
        probes += 1;
        return new Response("gone", { status: 404 });
      }, controller.signal),
      fetchPayload: async () => THREE_STREAMS,
      resolveGateProbe: true,
    });

    expect(probes).toBe(0);
    // Returning the selection anyway would start playback on a resolve the user
    // already abandoned.
    expect(result.status).toBe("exhausted");
    expect(result.streams).toHaveLength(0);
    const failure = result.failures.at(-1);
    expect(failure?.code).toBe("cancelled");
    // Cancellation is not evidence about the provider, so it must not be
    // reported as a health failure.
    expect(result.healthDelta).toBeUndefined();
  });

  test("an abort DURING a probe is a cancellation, not a stream failure", async () => {
    // The pre-probe guard only catches an abort before the first probe. This
    // aborts while the probe promise is in flight — its result must not become a
    // `not-found` failure that penalises provider health.
    const controller = new AbortController();
    let probes = 0;

    const result = await resolveDirectStreamSource({
      providerId: "vidlink",
      host: "vidlink.pro",
      label: "VidLink",
      input: createInput(),
      context: createContext(async () => {
        probes += 1;
        controller.abort();
        return new Response("gone", { status: 404 });
      }, controller.signal),
      // A single candidate, so there is no next loop iteration to catch the
      // abort — only the post-probe guard can, which is the path under test.
      fetchPayload: async () => ({ streams: [{ url: "https://cdn.example/only.mp4" }] }),
      resolveGateProbe: true,
    });

    expect(probes).toBe(1);
    expect(result.status).toBe("exhausted");
    expect(result.failures.at(-1)?.code).toBe("cancelled");
    expect(result.healthDelta).toBeUndefined();
  });

  test("season 0 specials are resolvable, and a missing episode still fails closed", async () => {
    const special = await resolveDirectStreamSource({
      providerId: "vidlink",
      host: "vidlink.pro",
      label: "VidLink",
      input: createInput({
        mediaKind: "series",
        episode: { season: 0, episode: 1 },
      } as Partial<ProviderResolveInput>),
      context: createContext(async () => new Response("ok")),
      fetchPayload: async () => THREE_STREAMS,
    });
    expect(special.status).toBe("resolved");

    const missing = await resolveDirectStreamSource({
      providerId: "vidlink",
      host: "vidlink.pro",
      label: "VidLink",
      input: createInput({ mediaKind: "series" } as Partial<ProviderResolveInput>),
      context: createContext(async () => new Response("ok")),
      fetchPayload: async () => THREE_STREAMS,
    });
    expect(missing.status).toBe("exhausted");
  });
});
