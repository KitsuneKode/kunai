import { expect, test } from "bun:test";

import type { StreamInfo, TitleInfo } from "@/domain/types";
import { PlaybackResolveService } from "@/services/playback/PlaybackResolveService";
import type { Provider } from "@/services/providers/Provider";
import type { ProviderRegistry } from "@/services/providers/ProviderRegistry";

const title: TitleInfo = {
  id: "demo",
  type: "series",
  name: "Demo",
  year: "2026",
};

const stream: StreamInfo = {
  url: "https://cdn.example/stream.m3u8",
  headers: {},
  timestamp: 1,
};

test("PlaybackResolveService returns cached stream without provider resolve", async () => {
  const cache = createMemoryCache(stream);
  let providerCalls = 0;
  const service = new PlaybackResolveService({
    cacheStore: cache,
    providerRegistry: createRegistry([
      createProvider("vidking", async () => {
        providerCalls += 1;
        return stream;
      }),
    ]),
  });

  const result = await service.resolve(createInput("vidking"));

  expect(result.cacheStatus).toBe("hit");
  expect(result.stream?.cacheProvenance).toBe("cached");
  expect(providerCalls).toBe(0);
});

test("PlaybackResolveService falls back and persists stream under resolved provider", async () => {
  const cache = createMemoryCache(null);
  const fallbackStream = { ...stream, url: "https://fallback.example/stream.m3u8" };
  const service = new PlaybackResolveService({
    cacheStore: cache,
    providerRegistry: createRegistry([
      createProvider("primary", async () => null),
      createProvider("fallback", async () => fallbackStream),
    ]),
    maxAttempts: 1,
  });

  const result = await service.resolve(createInput("primary"));

  expect(result.providerId).toBe("fallback");
  expect(result.stream?.url).toBe(fallbackStream.url);
  expect(cache.setKeys).toEqual(["api-resolve:fallback:series:demo:1:2:series:eng:sub"]);
});

test("PlaybackResolveService does not persist after hard abort", async () => {
  const cache = createMemoryCache(null);
  const controller = new AbortController();
  const service = new PlaybackResolveService({
    cacheStore: cache,
    providerRegistry: createRegistry([
      createProvider("vidking", async () => {
        controller.abort();
        return stream;
      }),
    ]),
    maxAttempts: 1,
  });

  const result = await service.resolve(createInput("vidking", controller.signal));

  expect(result.stream?.url).toBe(stream.url);
  expect(cache.setKeys).toEqual([]);
});

function createInput(providerId: string, signal = new AbortController().signal) {
  return {
    title,
    episode: { season: 1, episode: 2 },
    mode: "series" as const,
    providerId,
    subLang: "eng",
    animeLang: "sub" as const,
    signal,
  };
}

function createProvider(id: string, resolveStream: Provider["resolveStream"]): Provider {
  return {
    metadata: {
      id,
      name: id,
      description: id,
      recommended: false,
      isAnimeProvider: false,
    },
    capabilities: {
      contentTypes: ["movie", "series"],
    },
    canHandle: () => true,
    resolveStream,
  };
}

function createRegistry(providers: readonly Provider[]): ProviderRegistry {
  return {
    get: (id) => providers.find((provider) => provider.metadata.id === id),
    getAll: () => [...providers],
    getAllIds: () => providers.map((provider) => provider.metadata.id),
    getCompatible: () => [...providers],
    getDefault: () => providers[0]!,
    getMetadata: (id) => providers.find((provider) => provider.metadata.id === id)?.metadata,
  };
}

function createMemoryCache(initial: StreamInfo | null) {
  const setKeys: string[] = [];
  return {
    setKeys,
    ttl: 1,
    get: async () => initial,
    set: async (key: string) => {
      setKeys.push(key);
    },
    delete: async () => {},
    clear: async () => {},
    prune: async () => {},
  };
}
