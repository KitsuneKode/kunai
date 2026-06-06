import { describe, expect, test } from "bun:test";

import { normalizeSourceName } from "@/domain/playback/source-name";

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
