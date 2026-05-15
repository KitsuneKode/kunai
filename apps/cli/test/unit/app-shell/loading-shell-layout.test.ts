import { describe, expect, test } from "bun:test";

import {
  formatLoadingProviderLine,
  shouldShowLoadingPosterCompanion,
} from "@/app-shell/loading-shell";

describe("loading shell layout", () => {
  test("shows playback artwork only for active playback on wide terminals", () => {
    expect(
      shouldShowLoadingPosterCompanion({
        operation: "playing",
        columns: 150,
        posterUrl: "/poster.jpg",
        posterKind: "none",
        posterState: "loading",
      }),
    ).toBe(true);
  });

  test("keeps loading/resolving shells text-first even with poster data", () => {
    expect(
      shouldShowLoadingPosterCompanion({
        operation: "resolving",
        columns: 150,
        posterUrl: "/poster.jpg",
        posterKind: "kitty",
        posterState: "ready",
      }),
    ).toBe(false);
  });

  test("hides active playback artwork when the terminal is too narrow", () => {
    expect(
      shouldShowLoadingPosterCompanion({
        operation: "playing",
        columns: 118,
        posterUrl: "/poster.jpg",
        posterKind: "kitty",
        posterState: "ready",
      }),
    ).toBe(false);
  });

  test("formats active provider identity for playback supervision", () => {
    expect(formatLoadingProviderLine({ providerName: "VidKing", providerId: "vidking" })).toBe(
      "VidKing (vidking)",
    );
    expect(formatLoadingProviderLine({ providerId: "allanime" })).toBe("allanime");
    expect(formatLoadingProviderLine({})).toBeNull();
  });
});
