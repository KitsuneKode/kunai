import { describe, expect, test } from "bun:test";

import { finalizeVidkingSourceInventory } from "../src/videasy/direct";
import {
  flavorSourceId,
  getPhaseAVidkingFlavorIds,
  getVidkingFlavor,
  getVidkingFlavorForEndpoint,
  listEligibleVidkingFlavorIds,
  listPhaseBLazyProbeFlavorIds,
  normalizeLegacyVideasySourceId,
  resolveFlavorEngineOptions,
  resolveVidkingPresentation,
  vidkingSourceIdForFlavor,
  vidkingSourceIdForEndpoint,
} from "../src/videasy/flavors";

describe("vidking flavors", () => {
  test("eligible flavor inventory includes all twelve flavors for movies", () => {
    expect(listEligibleVidkingFlavorIds("movie")).toHaveLength(12);
  });

  test("phase A lists Luffy Zoro Nami in order", () => {
    expect(getPhaseAVidkingFlavorIds()).toEqual([
      "videasy-primary",
      "videasy-mirror-a",
      "videasy-mirror-b",
    ]);
  });

  test("resolveFlavorEngineOptions maps Luffy to mb-flix", () => {
    expect(resolveFlavorEngineOptions("videasy-primary")).toMatchObject({
      flavorId: "videasy-primary",
      serverEndpoint: "mb-flix",
      flavorLabel: "Luffy",
    });
  });

  test("phase B includes every mapped non-blocking flavor in order", () => {
    const ids = listPhaseBLazyProbeFlavorIds();
    expect(ids).toEqual([
      "videasy-mirror-c",
      "videasy-breach",
      "videasy-english-alt",
      "videasy-german",
      "videasy-hindi",
      "videasy-spanish",
      "videasy-portuguese",
      "videasy-italian",
      "videasy-french",
    ]);
    expect(ids).not.toContain("videasy-primary");
  });

  test("phase B excludes movie-only flavors for series", () => {
    expect(listPhaseBLazyProbeFlavorIds("series")).not.toContain("videasy-french");
  });

  test("Law is movies only", () => {
    expect(getVidkingFlavor("videasy-french")?.moviesOnly).toBe(true);
  });

  test("Breach maps to the Bitcine m4uhd Videasy endpoint", () => {
    expect(resolveFlavorEngineOptions("videasy-breach")).toMatchObject({
      flavorId: "videasy-breach",
      serverEndpoint: "m4uhd",
      flavorLabel: "Blackbeard",
    });
    expect(getVidkingFlavor("videasy-breach")?.cinebyAlias).toBe("Breach");
  });

  test("vidkingSourceIdForEndpoint is stable across episodes", () => {
    expect(vidkingSourceIdForEndpoint("mb-flix")).toBe("source:videasy:mb-flix");
    expect(vidkingSourceIdForEndpoint("mb-flix")).toBe(vidkingSourceIdForEndpoint("mb-flix"));
  });

  test("normalizeLegacyVideasySourceId maps pre-rename inventory ids", () => {
    expect(normalizeLegacyVideasySourceId("source:vidking:videasy:mb-flix")).toBe(
      "source:videasy:mb-flix",
    );
    expect(normalizeLegacyVideasySourceId("source:vidking:mb-flix")).toBe("source:videasy:mb-flix");
    expect(normalizeLegacyVideasySourceId("source:vidking:videasy-hindi")).toBe(
      "source:videasy:videasy-hindi",
    );
    expect(normalizeLegacyVideasySourceId("source:videasy:mb-flix")).toBe("source:videasy:mb-flix");
  });

  test("resolveVidkingPresentation maps mb-flix to Luffy", () => {
    expect(resolveVidkingPresentation("mb-flix")).toMatchObject({
      flavorId: "videasy-primary",
      themeLabel: "Luffy",
      subtitle: "Original · primary",
    });
  });

  test("Yoru carries the Bitcine 4K compatibility hint", () => {
    expect(resolveVidkingPresentation("cdn")).toMatchObject({
      flavorId: "videasy-mirror-a",
      themeLabel: "Zoro",
      subtitle: "Original · may have 4K",
    });
  });

  test("getVidkingFlavorForEndpoint disambiguates meine by language", () => {
    expect(getVidkingFlavorForEndpoint("meine", { languageQuery: "german" })?.themeLabel).toBe(
      "Brook",
    );
    expect(getVidkingFlavorForEndpoint("meine", { languageQuery: "italian" })?.themeLabel).toBe(
      "Shanks",
    );
  });

  test("flavorSourceId matches endpoint source id", () => {
    expect(flavorSourceId("videasy-primary")).toBe(vidkingSourceIdForEndpoint("mb-flix"));
  });

  test("shared backend endpoints keep distinct flavor source ids", () => {
    expect(vidkingSourceIdForFlavor("videasy-german")).not.toBe(
      vidkingSourceIdForFlavor("videasy-italian"),
    );
    expect(vidkingSourceIdForFlavor("videasy-english-alt")).not.toBe(
      vidkingSourceIdForFlavor("videasy-hindi"),
    );
  });

  test("source inventory keeps order while reflecting selected failed and skipped states", () => {
    const failedSourceId = flavorSourceId("videasy-primary");
    const selectedSourceId = flavorSourceId("videasy-mirror-a");
    const skippedSourceId = flavorSourceId("videasy-mirror-b");
    const sources = finalizeVidkingSourceInventory({
      sources: [
        sourceCandidate(failedSourceId, "Luffy"),
        sourceCandidate(selectedSourceId, "Zoro"),
        sourceCandidate(skippedSourceId, "Nami"),
      ],
      attempts: [
        {
          candidate: {
            id: "candidate:luffy",
            providerId: "vidking",
            sourceId: failedSourceId,
            label: "Luffy",
            priority: 0,
          },
          attempt: 1,
          startedAt: "2026-05-01T00:00:00.000Z",
          endedAt: "2026-05-01T00:00:01.000Z",
          failure: {
            providerId: "vidking",
            candidateId: "candidate:luffy",
            failureClass: "candidate-empty",
            message: "No playable source",
            retryable: false,
            at: "2026-05-01T00:00:01.000Z",
          },
        },
        {
          candidate: {
            id: "candidate:zoro",
            providerId: "vidking",
            sourceId: selectedSourceId,
            label: "Zoro",
            priority: 1,
          },
          attempt: 1,
          startedAt: "2026-05-01T00:00:01.000Z",
          endedAt: "2026-05-01T00:00:02.000Z",
        },
      ],
      selectedSources: [
        {
          ...sourceCandidate(selectedSourceId, "Zoro"),
          status: "selected",
          confidence: 0.9,
        },
      ],
      streams: [
        {
          id: "stream:zoro:1080",
          providerId: "vidking",
          sourceId: selectedSourceId,
          url: "https://cdn.example/zoro.m3u8",
          protocol: "hls",
          confidence: 0.9,
          cachePolicy: {
            ttlClass: "stream-manifest",
            scope: "local",
            keyParts: ["zoro"],
          },
        },
      ],
      selectedStreamId: "stream:zoro:1080",
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
    host: "api.videasy.to",
    status: "probing" as const,
    confidence: 0.8,
  };
}
