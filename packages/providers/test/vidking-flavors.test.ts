import { describe, expect, test } from "bun:test";

import {
  flavorSourceId,
  getPhaseAVidkingFlavorIds,
  getVidkingFlavor,
  getVidkingFlavorForEndpoint,
  listPhaseBLazyProbeFlavorIds,
  resolveFlavorEngineOptions,
  resolveVidkingPresentation,
  vidkingSourceIdForFlavor,
  vidkingSourceIdForEndpoint,
} from "../src/vidking/flavors";

describe("vidking flavors", () => {
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

  test("phase B includes English mirrors and preferred audio language", () => {
    const ids = listPhaseBLazyProbeFlavorIds("de");
    expect(ids).toContain("videasy-mirror-c");
    expect(ids).toContain("videasy-german");
    expect(ids).not.toContain("videasy-primary");
  });

  test("Law is movies only", () => {
    expect(getVidkingFlavor("videasy-french")?.moviesOnly).toBe(true);
  });

  test("vidkingSourceIdForEndpoint is stable across episodes", () => {
    expect(vidkingSourceIdForEndpoint("mb-flix")).toBe("source:vidking:videasy:mb-flix");
    expect(vidkingSourceIdForEndpoint("mb-flix")).toBe(vidkingSourceIdForEndpoint("mb-flix"));
  });

  test("resolveVidkingPresentation maps mb-flix to Luffy", () => {
    expect(resolveVidkingPresentation("mb-flix")).toMatchObject({
      flavorId: "videasy-primary",
      themeLabel: "Luffy",
      subtitle: "English · primary",
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
});
