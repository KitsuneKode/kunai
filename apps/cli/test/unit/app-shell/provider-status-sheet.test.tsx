import { describe, expect, test } from "bun:test";

import { ProviderStatusSheet } from "@/app-shell/provider-status/ProviderStatusSheet";
import type { Container } from "@/container";
import React from "react";

import { CAPTURE_WIDTHS, captureFrame } from "../../harness/render-capture";

function createMockContainer(): Container {
  const stateManager = {
    getState: () => ({
      provider: "vidrock",
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
        id: "kickassanime",
        name: "KickAssAnime Extended",
        providerLane: "anime" as const,
        domain: "kaa.lt",
        description: "Anime catalog and stream resolver",
        capabilities: ["quality-ranked", "subtitle-resolve", "multi-source"],
      },
    },
  ];

  const container = {
    stateManager,
    config: {
      getRaw: () => ({
        disabledProviders: [],
        provider: "vidrock",
        animeProvider: "kickassanime",
        youtubeProvider: "youtube",
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
          mediaKinds: found.metadata.providerLane === "anime" ? ["anime"] : ["series", "movie"],
          capabilities: found.metadata.capabilities,
          description: found.metadata.description,
          domain: found.metadata.domain,
          recommended: true,
        };
      },
    },
    providerHealth: new Map([
      [
        "vidrock",
        {
          status: "healthy",
          medianResolveMs: 350,
          recentFailureRate: 0,
          observations: 10,
        },
      ],
      [
        "kickassanime",
        {
          status: "healthy",
          medianResolveMs: 650,
          recentFailureRate: 0.3,
          observations: 20,
        },
      ],
    ]),
  };
  // SAFETY: Mock test container providing only the fields consumed by ProviderStatusSheet
  return container as never;
}

describe("ProviderStatusSheet", () => {
  test("renders columns with clear separation and without capability text collision", () => {
    const container = createMockContainer();
    const frame = captureFrame(
      <ProviderStatusSheet container={container} width={100} onClose={() => {}} />,
      { columns: CAPTURE_WIDTHS.wide },
    );

    expect(frame).toContain("STATUS");
    expect(frame).toContain("PROVIDER");
    expect(frame).toContain("LANE");
    expect(frame).toContain("LATENCY");
    expect(frame).toContain("CAPABILITIES");
    expect(frame).toContain("EVIDENCE");

    // Ensure capabilities and reachability never merge into "Sub70%"
    expect(frame).not.toMatch(/Sub\d+%/);
    expect(frame).not.toMatch(/Multi\d+%/);
    expect(frame).toContain("70% reachability");
    expect(frame).toContain("VidRock Direct");
  });
});
