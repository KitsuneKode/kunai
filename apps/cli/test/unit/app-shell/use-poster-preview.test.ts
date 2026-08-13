import { describe, expect, test } from "bun:test";

import { __testing } from "@/app-shell/use-poster-preview";

const {
  posterPreviewReducer,
  initialPosterPreviewState,
  posterRequestKey,
  visiblePosterPreviewState,
} = __testing;

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

  test("repeat loading returns the SAME state reference so React bails the re-render", () => {
    const loadingOnce = posterPreviewReducer(initialPosterPreviewState, { type: "loading" });
    const loadingTwice = posterPreviewReducer(loadingOnce, { type: "loading" });
    // Identity, not just equality: this is what lets a held ↑/↓ burst dispatch
    // "loading" every keystroke without forcing an extra commit per key.
    expect(loadingTwice).toBe(loadingOnce);
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

  test("hides a sixel result when the requested title changes", () => {
    const resolved = posterPreviewReducer(initialPosterPreviewState, {
      type: "resolved",
      result: {
        kind: "sixel",
        sixel: "old-pixels",
        rows: 4,
        cols: 8,
        overlayId: "browse-preview",
      },
      sourceKey: "old-title",
    });

    expect(visiblePosterPreviewState(resolved, "old-title")).toBe(resolved);
    expect(visiblePosterPreviewState(resolved, "new-title")).toMatchObject({
      poster: { kind: "none" },
      posterState: "loading",
      spinner: false,
    });
  });

  test("includes geometry in the sixel request identity", () => {
    const base = {
      variant: "preview" as const,
      allowKitty: true,
      allowSixel: true,
      inkEmbedded: false,
      placementSlot: "browse-preview" as const,
    };
    expect(posterRequestKey("poster.jpg", { ...base, rows: 4, cols: 8 })).not.toBe(
      posterRequestKey("poster.jpg", { ...base, rows: 6, cols: 8 }),
    );
  });

  test("distinguishes stable text fallback from framebuffer sixel", () => {
    const base = {
      rows: 4,
      cols: 8,
      variant: "preview" as const,
      allowKitty: true,
      inkEmbedded: false,
      placementSlot: "playing-rail" as const,
    };
    expect(posterRequestKey("poster.jpg", { ...base, allowSixel: true })).not.toBe(
      posterRequestKey("poster.jpg", { ...base, allowSixel: false }),
    );
  });
});

// The spinner exists to signal a *slow* poster. Every rule below is about it
// staying silent otherwise — a spinner that flashes on cached art or fires after
// the image lands is worse than no spinner at all.
describe("spinner state", () => {
  const loading = posterPreviewReducer(initialPosterPreviewState, { type: "loading" });

  test("no fetch has started, so nothing spins", () => {
    expect(initialPosterPreviewState.spinner).toBe(false);
    expect(loading.spinner).toBe(false);
  });

  test("a pending fetch raises the spinner once the timer fires", () => {
    expect(posterPreviewReducer(loading, { type: "spinner" }).spinner).toBe(true);
  });

  test("a resolved poster clears the spinner", () => {
    const spinning = posterPreviewReducer(loading, { type: "spinner" });
    const resolved = posterPreviewReducer(spinning, {
      type: "resolved",
      result: { kind: "text", placeholder: "▀", rows: 4, cols: 8 },
    });
    expect(resolved.spinner).toBe(false);
  });

  test("a late timer cannot spin over an image that already landed", () => {
    // The arming timer outlives the fetch it was armed for whenever the fetch
    // resolves first. Without the posterState guard this would put a spinner on
    // top of a poster that is already on screen.
    const resolved = posterPreviewReducer(loading, {
      type: "resolved",
      result: { kind: "text", placeholder: "▀", rows: 4, cols: 8 },
    });
    expect(posterPreviewReducer(resolved, { type: "spinner" })).toBe(resolved);
  });

  test("a late timer cannot spin over a failed fetch", () => {
    const failed = posterPreviewReducer(loading, { type: "reset", posterState: "unavailable" });
    expect(posterPreviewReducer(failed, { type: "spinner" })).toBe(failed);
  });

  test("re-arming while already spinning keeps the same state reference", () => {
    const spinning = posterPreviewReducer(loading, { type: "spinner" });
    expect(posterPreviewReducer(spinning, { type: "spinner" })).toBe(spinning);
  });

  test("a new fetch starts unspun even when the previous one was spinning", () => {
    const spinning = posterPreviewReducer(loading, { type: "spinner" });
    const resolved = posterPreviewReducer(spinning, {
      type: "resolved",
      result: { kind: "text", placeholder: "▀", rows: 4, cols: 8 },
    });
    // Navigating to a cached neighbour must not inherit the spinner.
    expect(posterPreviewReducer(resolved, { type: "loading" }).spinner).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stale-completion gate
//
// Calendar navigation issues one poster request per row. When row A's fetch is
// slower than row B's, A can resolve LAST — after the user already settled on
// B. Effect cleanup normally cancels A, but the reducer is the last line of
// defence: a completion that does not belong to the pending request must never
// replace the poster that is already on screen.
// ---------------------------------------------------------------------------

describe("usePosterPreview stale-completion gate", () => {
  const rowA = "calendar-row-a";
  const rowB = "calendar-row-b";
  const textPoster = (placeholder: string) =>
    ({ kind: "text", placeholder, rows: 4, cols: 8 }) as const;

  test("a completion for a superseded row cannot paint over the settled row", () => {
    // Navigate A → B, settle B, then let A land last.
    let state = posterPreviewReducer(initialPosterPreviewState, {
      type: "loading",
      sourceKey: rowA,
    });
    state = posterPreviewReducer(state, { type: "loading", sourceKey: rowB });
    const settled = posterPreviewReducer(state, {
      type: "resolved",
      result: textPoster("B"),
      sourceKey: rowB,
    });
    expect(settled.poster).toMatchObject({ placeholder: "B" });

    const late = posterPreviewReducer(settled, {
      type: "resolved",
      result: textPoster("A"),
      sourceKey: rowA,
    });
    // Identity, not just equality: the stale completion must not even re-render.
    expect(late).toBe(settled);
  });

  test("the pending row's own completion still paints", () => {
    const loading = posterPreviewReducer(initialPosterPreviewState, {
      type: "loading",
      sourceKey: rowB,
    });
    const resolved = posterPreviewReducer(loading, {
      type: "resolved",
      result: textPoster("B"),
      sourceKey: rowB,
    });
    expect(resolved.posterState).toBe("ready");
    expect(resolved.poster).toMatchObject({ placeholder: "B" });
  });

  test("re-requesting the same row keeps the same state reference during a burst", () => {
    const first = posterPreviewReducer(initialPosterPreviewState, {
      type: "loading",
      sourceKey: rowA,
    });
    expect(posterPreviewReducer(first, { type: "loading", sourceKey: rowA })).toBe(first);
  });
});
