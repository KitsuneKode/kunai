import { describe, expect, test } from "bun:test";

import {
  buildProviderStatusMatrix,
  PROVIDER_PROBE_ENDPOINTS,
} from "@/app-shell/provider-status/provider-status-model";
import type { Container } from "@/container";
import type { ProviderId } from "@kunai/types";

function createMockContainer(
  overrides: {
    readonly disabled?: string[];
    readonly activeProvider?: string;
    readonly animeProvider?: string;
    readonly youtubeProvider?: string;
  } = {},
): Container {
  const stateManager = {
    getState: () => ({
      provider: overrides.activeProvider ?? "vidrock",
      mode: "series" as const,
    }),
    dispatch: () => {},
  };

  const registered = [
    {
      metadata: {
        id: "vidrock",
        name: "VidRock Direct",
        providerLane: "series" as const,
        domain: "vidrock.net",
        description: "Primary HLS streaming",
        capabilities: ["quality-ranked", "subtitle-resolve", "source-resolve"],
      },
    },
    {
      metadata: {
        id: "allmanga",
        name: "AllManga",
        providerLane: "anime" as const,
        domain: "allmanga.to",
        description: "Anime catalog and stream resolver",
        capabilities: ["quality-ranked", "subtitle-resolve"],
      },
    },
    {
      metadata: {
        id: "youtube",
        name: "YouTube",
        providerLane: "youtube" as const,
        domain: "youtube.com",
        description: "Video stream and suggestion provider",
        capabilities: ["quality-ranked"],
      },
    },
  ];

  const container = {
    stateManager,
    config: {
      getRaw: () => ({
        disabledProviders: overrides.disabled ?? [],
        provider: overrides.activeProvider ?? "vidrock",
        animeProvider: overrides.animeProvider ?? "allmanga",
        youtubeProvider: overrides.youtubeProvider ?? "youtube",
      }),
      writeConfig: async () => {},
    },
    providerRegistry: {
      getAllRegistered: () => registered,
      get: (id: string) => registered.find((r) => r.metadata.id === id),
      getManifest: (id: string) => {
        const found = registered.find((r) => r.metadata.id === id);
        if (!found) return undefined;
        return {
          id: found.metadata.id,
          displayName: found.metadata.name,
          mediaKinds:
            found.metadata.providerLane === "anime"
              ? ["anime"]
              : found.metadata.providerLane === "youtube"
                ? ["video"]
                : ["series", "movie"],
          capabilities: found.metadata.capabilities,
          description: found.metadata.description,
          domain: found.metadata.domain,
          recommended: true,
        };
      },
    },
    providerHealth: (() => {
      const healthMap = new Map<string, any>([
        [
          "vidrock",
          {
            providerId: "vidrock",
            status: "healthy",
            checkedAt: new Date().toISOString(),
            medianResolveMs: 350,
            recentFailureRate: 0,
            observations: 10,
          },
        ],
        [
          "allmanga",
          {
            providerId: "allmanga",
            status: "healthy",
            checkedAt: new Date().toISOString(),
            medianResolveMs: 650,
            recentFailureRate: 0.05,
            observations: 20,
          },
        ],
      ]);
      return {
        get: (id: string) => healthMap.get(id),
        set: (health: any) => healthMap.set(health.providerId, health),
        list: () => Array.from(healthMap.values()),
        delete: (id: string) => healthMap.delete(id),
        deleteMany: (ids: readonly string[]) => {
          let count = 0;
          for (const id of ids) if (healthMap.delete(id)) count++;
          return count;
        },
        clearAll: () => healthMap.clear(),
      };
    })(),
  };
  // SAFETY: Mock test container providing only the fields consumed by buildProviderStatusMatrix
  return container as never;
}

describe("buildProviderStatusMatrix", () => {
  test("builds provider matrix with health data, capabilities and lane categorization", () => {
    const container = createMockContainer();
    const matrix = buildProviderStatusMatrix(container);

    expect(matrix.totalCount).toBe(3);
    expect(matrix.healthyCount).toBe(2);
    expect(matrix.disabledCount).toBe(0);

    const vidrock = matrix.entries.find((e) => e.id === "vidrock");
    expect(vidrock).toBeDefined();
    expect(vidrock?.status).toBe("healthy");
    expect(vidrock?.isActive).toBe(true);
    expect(vidrock?.lane).toBe("series");
    expect(vidrock?.capabilities).toContain("4K/1080p");
    expect(vidrock?.capabilities).toContain("Sub");

    const allmanga = matrix.entries.find((e) => e.id === "allmanga");
    expect(allmanga).toBeDefined();
    expect(allmanga?.lane).toBe("anime");
    expect(allmanga?.capabilities).toContain("Dub");

    const youtube = matrix.entries.find((e) => e.id === "youtube");
    expect(youtube).toBeDefined();
    expect(youtube?.lane).toBe("youtube");
  });

  test("disabled providers are reflected in matrix counts and status", () => {
    const container = createMockContainer({ disabled: ["vidrock"] });
    const matrix = buildProviderStatusMatrix(container);

    expect(matrix.disabledCount).toBe(1);
    const vidrock = matrix.entries.find((e) => e.id === "vidrock");
    expect(vidrock?.disabled).toBe(true);
    expect(vidrock?.status).toBe("unknown");
    expect(vidrock?.evidence).toBe("Disabled in user config");
  });

  test("live overrides update entry status, latency and evidence", () => {
    const container = createMockContainer();
    const overrides = new Map([
      [
        "youtube",
        {
          status: "healthy" as const,
          latencyMs: 120,
          httpStatus: 200,
          evidence: "HTTP 200 OK (120ms)",
        },
      ],
    ]);

    const matrix = buildProviderStatusMatrix(container, overrides);
    const youtube = matrix.entries.find((e) => e.id === "youtube");
    expect(youtube?.status).toBe("healthy");
    expect(youtube?.latencyMs).toBe(120);
    expect(youtube?.evidence).toBe("HTTP 200 OK (120ms)");
    expect(matrix.healthyCount).toBe(3);
  });

  test("down provider formats consecutive failures in evidence", () => {
    const container = createMockContainer();
    container.providerHealth.set({
      // SAFETY: test fixture provider ID conforming to ProviderId
      providerId: "vidrock" as ProviderId,
      status: "down",
      checkedAt: new Date().toISOString(),
      consecutiveFailures: 5,
      recentFailureRate: 0.3,
      observations: 10,
    });

    const matrix = buildProviderStatusMatrix(container);
    const vidrock = matrix.entries.find((e) => e.id === "vidrock");
    expect(vidrock?.status).toBe("down");
    expect(vidrock?.evidence).toContain("5 consecutive fails");
    expect(vidrock?.evidence).toContain("70% reachability");
  });

  test("heals stale down provider by TTL", () => {
    const container = createMockContainer();
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    container.providerHealth.set({
      // SAFETY: test fixture provider ID conforming to ProviderId
      providerId: "vidrock" as ProviderId,
      status: "down",
      checkedAt: tenHoursAgo,
      consecutiveFailures: 5,
      recentFailureRate: 0.2,
      observations: 10,
    });

    const matrix = buildProviderStatusMatrix(container);
    const vidrock = matrix.entries.find((e) => e.id === "vidrock");
    expect(vidrock?.status).toBe("healthy");
    expect(vidrock?.evidence).toContain("Healed by TTL (was down)");
  });
});

describe("PROVIDER_PROBE_ENDPOINTS", () => {
  test("defines canonical live endpoints for essential providers", () => {
    expect(PROVIDER_PROBE_ENDPOINTS.vidrock).toBeDefined();
    expect(PROVIDER_PROBE_ENDPOINTS.allmanga).toBeDefined();
    expect(PROVIDER_PROBE_ENDPOINTS.youtube).toBeDefined();
    expect(PROVIDER_PROBE_ENDPOINTS.hianime).toBeDefined();
    expect(PROVIDER_PROBE_ENDPOINTS.rivestream).toBeDefined();
  });
});
