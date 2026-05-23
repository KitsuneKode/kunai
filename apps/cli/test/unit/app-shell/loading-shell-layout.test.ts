import { describe, expect, test } from "bun:test";

import { formatLoadingProviderLine } from "@/app-shell/loading-shell";

describe("loading shell layout", () => {
  test("formats active provider identity for playback supervision", () => {
    expect(formatLoadingProviderLine({ providerName: "VidKing", providerId: "vidking" })).toBe(
      "VidKing (vidking)",
    );
    expect(formatLoadingProviderLine({ providerId: "allanime" })).toBe("allanime");
    expect(formatLoadingProviderLine({})).toBeNull();
  });
});
