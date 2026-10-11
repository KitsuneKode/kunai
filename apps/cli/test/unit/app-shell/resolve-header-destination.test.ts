import { describe, expect, test } from "bun:test";

import { resolveHeaderDestination } from "@/app-shell/resolve-header-destination";

describe("resolveHeaderDestination", () => {
  const baseState = {
    playbackStatus: "idle" as const,
    view: "home" as const,
    currentTitle: null,
  };

  test("root overlay wins over browse destination", () => {
    expect(
      resolveHeaderDestination({
        state: baseState,
        rootOverlay: { type: "settings" },
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        rootContent: { id: 1, kind: "browse", element: null as never },
        browseDestinationLabel: "Search",
        playbackActive: false,
      }),
    ).toBe("Settings");
    expect(
      resolveHeaderDestination({
        state: baseState,
        rootOverlay: { type: "library", view: "queue" },
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        rootContent: { id: 1, kind: "browse", element: null as never },
        browseDestinationLabel: "Search",
        playbackActive: false,
      }),
    ).toBe("Downloads");
    expect(
      resolveHeaderDestination({
        state: baseState,
        rootOverlay: { type: "diagnostics" },
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        rootContent: { id: 1, kind: "browse", element: null as never },
        browseDestinationLabel: "Trending",
        playbackActive: false,
      }),
    ).toBe("Diagnostics");
  });

  test("mounted stats uses headerLabel instead of Picker", () => {
    expect(
      resolveHeaderDestination({
        state: baseState,
        rootOverlay: null,
        rootContent: {
          id: 2,
          kind: "picker",
          headerLabel: "Stats",
          // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
          element: null as never,
        },
        browseDestinationLabel: "Browse",
        playbackActive: false,
      }),
    ).toBe("Stats");
  });

  test("browse destination only when browse is visible", () => {
    expect(
      resolveHeaderDestination({
        state: baseState,
        rootOverlay: null,
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        rootContent: { id: 1, kind: "browse", element: null as never },
        browseDestinationLabel: "Trending",
        playbackActive: false,
      }),
    ).toBe("Trending");
  });
});
