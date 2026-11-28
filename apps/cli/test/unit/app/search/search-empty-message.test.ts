import { describe, expect, test } from "bun:test";

import { buildSearchEmptyMessage } from "@/app/search/search-empty-message";

describe("an empty search says what to try", () => {
  test("a plain miss names the lane Tab switches to", () => {
    expect(buildSearchEmptyMessage({}, "series")).toBe(
      "Press Tab to search anime instead, or try fewer words.",
    );
    expect(buildSearchEmptyMessage({}, "anime")).toBe(
      "Press Tab to search shows & movies instead, or try fewer words.",
    );
  });

  test("a known cause still outranks the lane hint (#464)", () => {
    expect(
      buildSearchEmptyMessage({ providerSearchFailures: [{ providerId: "hianime" }] }, "anime"),
    ).toContain("Provider search failed (hianime)");
    expect(
      buildSearchEmptyMessage({ diagnosis: { code: "catalog-fallback" } }, "series"),
    ).toContain("TMDB is unreachable");
  });
});
