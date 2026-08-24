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

  test("a rate-limited CDN no longer condemns the whole provider", async () => {
    const result = await resolveDirectStreamSource({
      providerId: "vidlink",
      host: "vidlink.pro",
      label: "VidLink",
      input: createInput(),
      context: createContext(async () => new Response("slow down", { status: 429 })),
      fetchPayload: async () => THREE_STREAMS,
      resolveGateProbe: true,
    });

    expect(result.status).toBe("resolved");
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

  test("a cancelled resolve stops probing and is not recorded as a stream failure", async () => {
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
    expect(result.status).toBe("resolved");
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
