import { describe, expect, test } from "bun:test";

import {
  createPresentedSourceCandidate,
  providerInventorySourceId,
  streamPresentationFields,
} from "../src/shared/source-inventory";

describe("source inventory presentation", () => {
  test("providerInventorySourceId is stable", () => {
    expect(providerInventorySourceId("rivestream", "flowcast")).toBe("source:rivestream:flowcast");
    expect(providerInventorySourceId("rivestream", "flowcast")).toBe(
      providerInventorySourceId("rivestream", "flowcast"),
    );
  });

  test("createPresentedSourceCandidate sets label and flavor metadata", () => {
    const source = createPresentedSourceCandidate({
      providerId: "rivestream",
      sourceKey: "primevids",
      displayLabel: "PrimeVids",
      subtitle: "EN · PrimeVids",
      status: "available",
      confidence: 0.9,
    });
    expect(source.label).toBe("PrimeVids");
    expect(source.metadata?.flavorArchetype).toBe("EN · PrimeVids");
    expect(source.metadata?.flavorLabel).toBe("PrimeVids");
  });

  test("streamPresentationFields mirrors display label on streams", () => {
    expect(
      streamPresentationFields({ displayLabel: "FM HLS", subtitle: "Japanese · hardsub" }),
    ).toEqual({
      flavorLabel: "FM HLS",
      serverName: "FM HLS",
      flavorArchetype: "Japanese · hardsub",
    });
  });
});
