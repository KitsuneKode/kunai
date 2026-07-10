import { afterEach, describe, expect, test } from "bun:test";

import type { SearchResult } from "@/domain/types";
import { providerResolveResultToStreamInfo } from "@/services/providers/provider-result-adapter";
import { ProviderResolveFailureError } from "@kunai/core";

import { handoffAniListSearchPick } from "./helpers/anime-search-handoff";
import { createIsolatedContainer } from "./helpers/isolated-container";

const FARMING_LIFE_S2: SearchResult = {
  id: "197824",
  type: "series",
  title: "Farming Life in Another World Season 2",
  year: "2026",
  overview: "Second season.",
  posterPath: "https://img.example/farming.jpg",
  posterSource: "AniList",
  metadataSource: "AniList search",
  externalIds: { anilistId: "197824" },
  episodeCount: 12,
};

const SOLO_LEVELING: SearchResult = {
  id: "151807",
  type: "series",
  title: "Solo Leveling",
  year: "2024",
  overview: "Hunters and gates.",
  posterPath: "https://img.example/solo.jpg",
  posterSource: "AniList",
  metadataSource: "AniList trending",
  externalIds: { anilistId: "151807" },
  episodeCount: 12,
};

const disposers: Array<() => void> = [];
const liveProviderTest = process.env.KUNAI_LIVE_PROVIDER_TESTS === "1" ? test : test.skip;

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
});

describe("anime discovery → resolve handoff (CLI-shaped)", () => {
  test("miruro handoff keeps numeric AniList id and never hits AllManga search", async () => {
    const { container, dispose } = await createIsolatedContainer("miruro-handoff");
    disposers.push(dispose);

    let allanimeRequests = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("allanime.day")) allanimeRequests += 1;
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const { mapped, title, resolveInput } = await handoffAniListSearchPick(container, {
        discovery: FARMING_LIFE_S2,
        providerId: "miruro",
      });

      expect(allanimeRequests).toBe(0);
      expect(mapped.id).toBe("197824");
      expect(title.id).toBe("197824");
      expect(resolveInput.title.anilistId).toBe("197824");
      expect(resolveInput.title.id).toBe("197824");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("allanime handoff remaps to opaque id while preserving anilistId for replay", async () => {
    const { container, dispose } = await createIsolatedContainer("allanime-handoff");
    disposers.push(dispose);

    const { mapped, title, resolveInput } = await handoffAniListSearchPick(container, {
      discovery: SOLO_LEVELING,
      providerId: "allanime",
      searchProviderNative: async () => [
        {
          id: "LrLqaxWbfzjShWbXW",
          title: "Solo Leveling",
          type: "series",
          aniListId: 151807,
          malId: 151807,
        },
      ],
    });

    expect(mapped.id).toBe("LrLqaxWbfzjShWbXW");
    expect(title.id).toBe("LrLqaxWbfzjShWbXW");
    expect(mapped.externalIds?.anilistId).toBe("151807");
    expect(resolveInput.title.anilistId).toBe("151807");
    expect(resolveInput.title.id).toBe("LrLqaxWbfzjShWbXW");
  });

  test("miruro rejects opaque AllAnime id without externalIds (pre-fix regression)", async () => {
    const { container, dispose } = await createIsolatedContainer("miruro-regression");
    disposers.push(dispose);

    const broken = await handoffAniListSearchPick(container, {
      discovery: {
        ...FARMING_LIFE_S2,
        id: "LrLqaxWbfzjShWbXW",
        metadataSource: "AniList search + allanime search",
        externalIds: undefined,
      },
      providerId: "miruro",
    });

    expect(broken.resolveInput.title.id).toBe("LrLqaxWbfzjShWbXW");
    expect(broken.resolveInput.title.anilistId).toBeUndefined();

    let failure: ProviderResolveFailureError | null = null;
    try {
      await container.engine.resolve(broken.resolveInput, "miruro");
    } catch (error) {
      if (error instanceof ProviderResolveFailureError) failure = error;
      else throw error;
    }

    expect(failure?.failure.code).toBe("unsupported-title");
    expect(failure?.result?.streams.length).toBe(0);
  });

  liveProviderTest(
    "miruro listEpisodes after AniList handoff uses pipe titles without AniList/Jikan enrichment",
    async () => {
      const { container, dispose } = await createIsolatedContainer("miruro-episodes");
      disposers.push(dispose);

      const { title } = await handoffAniListSearchPick(container, {
        discovery: FARMING_LIFE_S2,
        providerId: "miruro",
      });

      const miruro = container.providerRegistry.get("miruro");
      expect(miruro?.listEpisodes).toBeDefined();

      let externalMetadataRequests = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input, init) => {
        const url = String(input);
        if (url.includes("graphql.anilist.co") || url.includes("api.jikan.moe")) {
          externalMetadataRequests += 1;
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      try {
        const episodes = await miruro!.listEpisodes!({ title }, new AbortController().signal);
        expect(externalMetadataRequests).toBe(0);
        expect(episodes && episodes.length > 0).toBe(true);
        expect(
          episodes?.some((episode) => episode.name && !/^Episode \d+$/.test(episode.name)),
        ).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
    { timeout: 60_000 },
  );

  liveProviderTest(
    "miruro resolves a playable stream after AniList search handoff (Farming Life S2)",
    async () => {
      const { container, dispose } = await createIsolatedContainer("miruro-resolve");
      disposers.push(dispose);

      const { request, resolveInput, title } = await handoffAniListSearchPick(container, {
        discovery: FARMING_LIFE_S2,
        providerId: "miruro",
        episode: 1,
      });

      expect(title.id).toBe("197824");

      const startedAt = Date.now();
      const result = await container.engine.resolve(resolveInput, "miruro");
      const resolveDurationMs = Date.now() - startedAt;

      const stream = providerResolveResultToStreamInfo({
        result,
        title: request.title.name,
        subtitlePreference: request.subtitlePreference,
      });

      expect(stream?.url).toBeTruthy();
      expect(result.failures).toHaveLength(0);
      expect(resolveDurationMs).toBeLessThan(60_000);
    },
    { timeout: 90_000 },
  );
});
