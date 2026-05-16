import { describe, expect, test } from "bun:test";

import { formatLoadingProviderLine } from "@/app-shell/loading-shell";

describe("formatLoadingProviderLine", () => {
  test("formats name and id together when both present and different", () => {
    expect(formatLoadingProviderLine({ providerName: "HiAnime", providerId: "hianime" })).toBe(
      "HiAnime (hianime)",
    );
  });

  test("returns name alone when name equals id", () => {
    expect(formatLoadingProviderLine({ providerName: "hianime", providerId: "hianime" })).toBe(
      "hianime",
    );
  });

  test("returns null when both are empty", () => {
    expect(
      formatLoadingProviderLine({ providerName: undefined, providerId: undefined }),
    ).toBeNull();
  });
});
