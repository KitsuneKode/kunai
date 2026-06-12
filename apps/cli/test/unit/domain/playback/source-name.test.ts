import { describe, expect, test } from "bun:test";

import {
  isFavoriteSource,
  normalizeSourceName,
  sortByFavorites,
  toggleFavoriteSource,
} from "@/domain/playback/source-name";

describe("normalizeSourceName", () => {
  test("lowercases, trims, strips spaces and punctuation", () => {
    expect(normalizeSourceName("VidLink")).toBe("vidlink");
    expect(normalizeSourceName("  Vid Link ")).toBe("vidlink");
    expect(normalizeSourceName("Vid-Link!")).toBe("vidlink");
    expect(normalizeSourceName("Neon 2")).toBe("neon2");
  });

  test("empty / whitespace-only collapses to empty string", () => {
    expect(normalizeSourceName("")).toBe("");
    expect(normalizeSourceName("   ")).toBe("");
  });
});

describe("toggleFavoriteSource", () => {
  test("adds a normalized name when absent", () => {
    expect(toggleFavoriteSource([], "VidLink")).toEqual(["vidlink"]);
  });

  test("removes when present (by normalized identity)", () => {
    expect(toggleFavoriteSource(["vidlink"], "Vid Link")).toEqual([]);
  });

  test("appends to existing entries when absent, preserving order", () => {
    expect(toggleFavoriteSource(["neon", "vidlink"], "Cypher")).toEqual([
      "neon",
      "vidlink",
      "cypher",
    ]);
  });

  test("blank label is a no-op", () => {
    expect(toggleFavoriteSource(["neon"], "   ")).toEqual(["neon"]);
  });
});

describe("isFavoriteSource", () => {
  test("matches by normalized identity", () => {
    expect(isFavoriteSource(["vidlink"], "Vid Link")).toBe(true);
    expect(isFavoriteSource(["vidlink"], "Neon")).toBe(false);
  });
});

describe("sortByFavorites", () => {
  const rows = [{ label: "Neon" }, { label: "Cypher" }, { label: "Fade" }] as const;

  test("pins favorites first, preserves relative order (stable)", () => {
    const out = sortByFavorites(rows, ["fade"], (r) => r.label);
    expect(out.map((r) => r.label)).toEqual(["Fade", "Neon", "Cypher"]);
  });

  test("multiple favorites follow favorite priority order", () => {
    const out = sortByFavorites(rows, ["fade", "neon"], (r) => r.label);
    expect(out.map((r) => r.label)).toEqual(["Fade", "Neon", "Cypher"]);
  });

  test("no favorites = original order unchanged", () => {
    const out = sortByFavorites(rows, [], (r) => r.label);
    expect(out.map((r) => r.label)).toEqual(["Neon", "Cypher", "Fade"]);
  });
});
