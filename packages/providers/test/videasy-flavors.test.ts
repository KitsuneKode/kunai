import { describe, expect, test } from "bun:test";

import { finalizeVidkingSourceInventory } from "../src/videasy/direct";
import {
  flavorSourceId,
  getPhaseAVidkingFlavorIds,
  getVidkingFlavorForEndpoint,
  listEligibleVidkingFlavorIds,
  listPhaseBLazyProbeFlavorIds,
  listDeprecatedVidkingEndpoints,
  listVidkingEndpoints,
  listVidkingFlavors,
  normalizeLegacyVideasySourceId,
  resolveFlavorEngineOptions,
  resolveVidkingPresentation,
  vidkingSourceIdForFlavor,
  vidkingSourceIdForEndpoint,
} from "../src/videasy/flavors";

describe("vidking flavors", () => {
  test("eligible flavor inventory is the active Cineby catalog (+ Cypher)", () => {
    // 10 Cineby UI servers + Cypher reliability mirror
    expect(listEligibleVidkingFlavorIds("movie")).toHaveLength(11);
    expect(listEligibleVidkingFlavorIds("series")).toHaveLength(11);
  });

  test("phase A contains only the bounded stable-first foreground tier", () => {
    // Inventory/UI still uses catalogOrder (Yoru first); resolve probes Neon first.
    expect(getPhaseAVidkingFlavorIds()).toEqual(["cineby-neon", "cineby-cypher", "cineby-yoru"]);
  });

  test("eligible inventory order follows Cineby Servers UI (Yoru first)", () => {
    expect(listEligibleVidkingFlavorIds("series").slice(0, 4)).toEqual([
      "cineby-yoru",
      "cineby-neon",
      "cineby-sage",
      "cineby-jett",
    ]);
  });

  test("resolveFlavorEngineOptions maps Neon to wings-neon2", () => {
    expect(resolveFlavorEngineOptions("cineby-neon")).toMatchObject({
      flavorId: "cineby-neon",
      serverEndpoint: "wings-neon2",
      flavorLabel: "Neon",
    });
  });

  test("phase B keeps non-fast active catalog sources for background inventory", () => {
    expect(listPhaseBLazyProbeFlavorIds()).toContain("cineby-sage");
    expect(listPhaseBLazyProbeFlavorIds("series")).toContain("cineby-killjoy");
    expect(listPhaseBLazyProbeFlavorIds()).not.toContain("videasy-german");
  });

  test("public flavor listing excludes deprecated migration rows", () => {
    const flavors = listVidkingFlavors();
    expect(flavors).toHaveLength(11);
    expect(flavors.map((flavor) => flavor.id)).toEqual([
      "cineby-yoru",
      "cineby-neon",
      "cineby-sage",
      "cineby-jett",
      "cineby-breach",
      "cineby-vyse",
      "cineby-killjoy",
      "cineby-fade",
      "cineby-omen",
      "cineby-raze",
      "cineby-cypher",
    ]);
  });

  test("listVidkingEndpoints includes Cineby routes and legacy dead routes", () => {
    const endpoints = listVidkingEndpoints();
    expect(endpoints).toContain("mb-flix");
    expect(endpoints).toContain("wings-cdn");
    expect(endpoints).toContain("wings-neon2");
    expect(endpoints).toContain("wings-ym");
    expect(endpoints).toContain("wings-jett");
    expect(endpoints).toContain("wings-meine");
    expect(endpoints).toContain("wings-lamovie");
    expect(endpoints.length).toBeGreaterThan(
      new Set(listVidkingFlavors().map((flavor) => flavor.endpoint)).size,
    );
    for (const endpoint of listDeprecatedVidkingEndpoints()) {
      expect(endpoints).toContain(endpoint);
    }
  });

  test("deprecated endpoint list excludes active wings routes", () => {
    const deprecated = listDeprecatedVidkingEndpoints();
    expect(deprecated).toContain("mb-flix");
    expect(deprecated).not.toContain("wings-cdn");
    expect(deprecated).not.toContain("wings-neon2");
  });

  test("vidkingSourceIdForEndpoint is stable across episodes", () => {
    expect(vidkingSourceIdForEndpoint("wings-cdn")).toBe("source:videasy:wings-cdn");
    expect(vidkingSourceIdForEndpoint("wings-cdn")).toBe(vidkingSourceIdForEndpoint("wings-cdn"));
  });

  test("normalizeLegacyVideasySourceId maps pre-rename and wingsdb inventory ids", () => {
    expect(normalizeLegacyVideasySourceId("source:vidking:videasy:mb-flix")).toBe(
      "source:videasy:wings-neon2",
    );
    expect(normalizeLegacyVideasySourceId("source:vidking:mb-flix")).toBe(
      "source:videasy:wings-neon2",
    );
    expect(normalizeLegacyVideasySourceId("source:videasy:wingsdb-hydrogen")).toBe(
      "source:videasy:wings-cdn",
    );
    expect(normalizeLegacyVideasySourceId("source:videasy:wingsdb-oxygen")).toBe(
      "source:videasy:wings-neon2",
    );
    // Bare endpoint suffix on current prefix also remaps to active Neon
    expect(normalizeLegacyVideasySourceId("source:videasy:mb-flix")).toBe(
      "source:videasy:wings-neon2",
    );
  });

  test("resolveVidkingPresentation maps wings-cdn to Yoru", () => {
    expect(resolveVidkingPresentation("wings-cdn")).toMatchObject({
      flavorId: "cineby-yoru",
      themeLabel: "Yoru",
    });
  });

  test("resolveVidkingPresentation maps wings-neon2 to Neon", () => {
    expect(resolveVidkingPresentation("wings-neon2")).toMatchObject({
      flavorId: "cineby-neon",
      themeLabel: "Neon",
    });
  });

  test("wings-meine carries the language dub hint for Killjoy", () => {
    expect(resolveVidkingPresentation("wings-meine", { language: "german" })).toMatchObject({
      flavorId: "cineby-killjoy",
      themeLabel: "Killjoy",
      subtitle: "German audio",
    });
  });

  test("getVidkingFlavorForEndpoint disambiguates hdmovie by quality filter", () => {
    expect(
      getVidkingFlavorForEndpoint("wings-hdmovie", { filterQuality: "English" })?.themeLabel,
    ).toBe("Vyse");
    expect(
      getVidkingFlavorForEndpoint("wings-hdmovie", { filterQuality: "Hindi" })?.themeLabel,
    ).toBe("Fade");
  });

  test("flavorSourceId matches endpoint source id for single-flavor endpoints", () => {
    expect(flavorSourceId("cineby-yoru")).toBe(vidkingSourceIdForEndpoint("wings-cdn"));
    expect(flavorSourceId("cineby-neon")).toBe(vidkingSourceIdForEndpoint("wings-neon2"));
  });

  test("shared backend endpoints keep distinct flavor source ids", () => {
    expect(vidkingSourceIdForFlavor("cineby-vyse")).not.toBe(
      vidkingSourceIdForFlavor("cineby-fade"),
    );
  });

  test("source inventory keeps order while reflecting selected failed and skipped states", () => {
    const failedSourceId = flavorSourceId("cineby-yoru");
    const selectedSourceId = flavorSourceId("cineby-neon");
    const skippedSourceId = flavorSourceId("cineby-cypher");
    const sources = finalizeVidkingSourceInventory({
      sources: [
        sourceCandidate(failedSourceId, "Yoru"),
        sourceCandidate(selectedSourceId, "Neon"),
        sourceCandidate(skippedSourceId, "Cypher"),
      ],
      attempts: [
        {
          candidate: {
            id: "candidate:yoru",
            providerId: "vidking",
            sourceId: failedSourceId,
            label: "Yoru",
            priority: 0,
          },
          attempt: 1,
          startedAt: "2026-05-01T00:00:00.000Z",
          endedAt: "2026-05-01T00:00:01.000Z",
          failure: {
            providerId: "vidking",
            candidateId: "candidate:yoru",
            failureClass: "candidate-empty",
            message: "No playable source",
            retryable: false,
            at: "2026-05-01T00:00:01.000Z",
          },
        },
        {
          candidate: {
            id: "candidate:neon",
            providerId: "vidking",
            sourceId: selectedSourceId,
            label: "Neon",
            priority: 1,
          },
          attempt: 1,
          startedAt: "2026-05-01T00:00:01.000Z",
          endedAt: "2026-05-01T00:00:02.000Z",
        },
      ],
      selectedSources: [
        {
          ...sourceCandidate(selectedSourceId, "Neon"),
          status: "selected",
          confidence: 0.9,
        },
      ],
      streams: [
        {
          id: "stream:neon:1080",
          providerId: "vidking",
          sourceId: selectedSourceId,
          url: "https://cdn.example/neon.m3u8",
          protocol: "hls",
          confidence: 0.9,
          cachePolicy: {
            ttlClass: "stream-manifest",
            scope: "local",
            keyParts: ["neon"],
          },
        },
      ],
      selectedStreamId: "stream:neon:1080",
    });

    expect(sources.map((source) => source.id)).toEqual([
      failedSourceId,
      selectedSourceId,
      skippedSourceId,
    ]);
    expect(sources.map((source) => source.status)).toEqual(["failed", "selected", "skipped"]);
    expect(sources[0]?.metadata?.failureReason).toBe("No playable source");
  });
});

function sourceCandidate(id: string, label: string) {
  return {
    id,
    providerId: "vidking" as const,
    kind: "provider-api" as const,
    label,
    host: "api.speedracelight.com",
    status: "probing" as const,
    confidence: 0.8,
  };
}
