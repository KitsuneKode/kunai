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
        rootContent: { id: 1, kind: "browse", element: null as never },
        browseDestinationLabel: "Search",
        playbackActive: false,
      }),
    ).toBe("Settings");
    expect(
      resolveHeaderDestination({
        state: baseState,
        rootOverlay: { type: "library", view: "queue" },
        rootContent: { id: 1, kind: "browse", element: null as never },
        browseDestinationLabel: "Search",
        playbackActive: false,
      }),
    ).toBe("Downloads");
    expect(
      resolveHeaderDestination({
        state: baseState,
        rootOverlay: { type: "diagnostics" },
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
        rootContent: { id: 1, kind: "browse", element: null as never },
        browseDestinationLabel: "Trending",
        playbackActive: false,
      }),
    ).toBe("Trending");
  });
});
