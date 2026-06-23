import { describe, expect, test } from "bun:test";

import type { CacheStore } from "@/services/persistence/CacheStore";
import { PlaybackResolveService } from "@/services/playback/PlaybackResolveService";
import type { ProviderEngine, ProviderEngineResolveOutput } from "@kunai/core";
import type { ProviderHealthRepository } from "@kunai/storage";
import type { MediaKind, ProviderHealth, ProviderId, ProviderResolveResult } from "@kunai/types";

const title = {
  id: "4242",
  type: "series" as const,
  name: "Harness Series",
};

const episode = { season: 1, episode: 3 };

function createMemoryCache(): CacheStore {
  return {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    clear: async () => {},
    prune: async () => {},
    ttl: () => 0,
  } as unknown as CacheStore;
}

function createProviderHealth(initial: readonly ProviderHealth[] = []) {
  const values = new Map(initial.map((entry) => [entry.providerId, entry]));
  return {
    get: (providerId: ProviderId) => values.get(providerId),
    set: (health: ProviderHealth) => values.set(health.providerId, health),
    entries: () => [...values.values()],
  } as unknown as ProviderHealthRepository;
}

function manifest(providerId: ProviderId, mediaKinds: readonly MediaKind[]) {
  return {
    id: providerId,
    displayName: providerId,
    aliases: [],
    description: providerId,
    domain: `${providerId}.example`,
    recommended: true,
    mediaKinds,
    capabilities: [],
    runtimePorts: [],
    cachePolicy: { ttlClass: "metadata", scope: "local", keyParts: [] },
    browserSafe: true,
    relaySafe: true,
    status: "production",
  };
}

function createHarnessEngine(onCandidateIds: (ids: readonly ProviderId[]) => void): ProviderEngine {
  const modules = [
    {
      providerId: "primary" as ProviderId,
      manifest: manifest("primary" as ProviderId, ["series"]),
    },
    {
      providerId: "fallback-a" as ProviderId,
      manifest: manifest("fallback-a" as ProviderId, ["series"]),
    },
    {
      providerId: "fallback-down" as ProviderId,
      manifest: manifest("fallback-down" as ProviderId, ["series"]),
    },
    {
      providerId: "anime-only" as ProviderId,
      manifest: manifest("anime-only" as ProviderId, ["anime"]),
    },
  ];
  const output: ProviderEngineResolveOutput = { result: null, providerId: null, attempts: [] };

  return {
    modules,
    get: () => undefined,
    getProviderIds: () => modules.map((module) => module.providerId),
    getManifest: (providerId: ProviderId) =>
      modules.find((module) => module.providerId === providerId)?.manifest,
    resolve: async () => ({}) as ProviderResolveResult,
    resolveWithFallback: async (_input: unknown, ids: readonly ProviderId[]) => {
      onCandidateIds(ids);
      return output;
    },
  } as unknown as ProviderEngine;
}

function recentDownHealth(providerId: ProviderId): ProviderHealth {
  return {
    providerId,
    status: "down",
    checkedAt: new Date().toISOString(),
    recentFailureRate: 1,
    consecutiveFailures: 5,
  };
}

function resolveInput(
  providerId: string,
  recoveryMode: "guided" | "fallback-first" | "manual" = "guided",
) {
  return {
    title,
    episode,
    mode: "series" as const,
    providerId,
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
    recoveryMode,
  };
}

describe("provider fallback harness", () => {
  test("automatic recovery tries only compatible providers and skips known-down fallbacks", async () => {
    let candidates: readonly ProviderId[] = [];
    const service = new PlaybackResolveService({
      engine: createHarnessEngine((ids) => {
        candidates = ids;
      }),
      cacheStore: createMemoryCache(),
      providerHealth: createProviderHealth([recentDownHealth("fallback-down" as ProviderId)]),
    });

    await service.resolve(resolveInput("primary"));

    expect(candidates).toEqual(["primary", "fallback-a"]);
  });

  test("manual recovery never cycles to fallback providers without user action", async () => {
    let candidates: readonly ProviderId[] = [];
    const service = new PlaybackResolveService({
      engine: createHarnessEngine((ids) => {
        candidates = ids;
      }),
      cacheStore: createMemoryCache(),
      providerHealth: createProviderHealth(),
    });

    await service.resolve(resolveInput("primary", "manual"));

    expect(candidates).toEqual(["primary"]);
  });

  test("explicit down provider selection still gets one direct attempt", async () => {
    let candidates: readonly ProviderId[] = [];
    const service = new PlaybackResolveService({
      engine: createHarnessEngine((ids) => {
        candidates = ids;
      }),
      cacheStore: createMemoryCache(),
      providerHealth: createProviderHealth([recentDownHealth("fallback-down" as ProviderId)]),
    });

    await service.resolve(resolveInput("fallback-down", "manual"));

    expect(candidates).toEqual(["fallback-down"]);
  });
});
