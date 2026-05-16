import { describe, expect, test } from "bun:test";

import { __testing } from "@/app-shell/use-poster-preview";

const { posterPreviewReducer, initialPosterPreviewState } = __testing;

describe("usePosterPreview reducer", () => {
  test("reset to idle clears poster", () => {
    const next = posterPreviewReducer(initialPosterPreviewState, {
      type: "reset",
      posterState: "idle",
    });
    expect(next.posterState).toBe("idle");
    expect(next.poster.kind).toBe("none");
  });

  test("reset to unavailable clears poster", () => {
    const next = posterPreviewReducer(initialPosterPreviewState, {
      type: "reset",
      posterState: "unavailable",
    });
    expect(next.posterState).toBe("unavailable");
  });

  test("loading preserves previous poster to avoid flash", () => {
    const withPoster = posterPreviewReducer(initialPosterPreviewState, {
      type: "resolved",
      result: { kind: "kitty", placeholder: "·", rows: 4, cols: 8, imageId: 1 },
    });
    const next = posterPreviewReducer(withPoster, {
      type: "loading",
    });
    expect(next.posterState).toBe("loading");
    expect(next.poster.kind).toBe("kitty");
  });

  test("resolved maps none result to unavailable state", () => {
    const next = posterPreviewReducer(initialPosterPreviewState, {
      type: "resolved",
      result: { kind: "none" },
    });
    expect(next.posterState).toBe("unavailable");
    expect(next.poster.kind).toBe("none");
  });

  test("resolved maps kitty result to ready", () => {
    const next = posterPreviewReducer(initialPosterPreviewState, {
      type: "resolved",
      result: {
        kind: "kitty",
        placeholder: "·",
        rows: 4,
        cols: 8,
        imageId: 1,
      },
    });
    expect(next.posterState).toBe("ready");
    expect(next.poster.kind).toBe("kitty");
  });
});
