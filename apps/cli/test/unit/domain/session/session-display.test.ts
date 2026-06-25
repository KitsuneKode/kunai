import { describe, expect, test } from "bun:test";

import {
  ensureSessionProviderMatchesLane,
  formatSessionLaneLabel,
  formatSessionProviderLabel,
  resolveProviderIdForSessionLane,
} from "@/domain/session/session-display";
import { createInitialState } from "@/domain/session/SessionState";

describe("session display helpers", () => {
  test("formats youtube lane labels for header crumbs", () => {
    expect(formatSessionLaneLabel("youtube")).toBe("YouTube");
    expect(formatSessionProviderLabel("youtube", "videasy", "Videasy")).toBe("YouTube");
  });

  test("resolves youtube lane provider when session provider is stale", () => {
    const state = {
      ...createInitialState(
        "videasy",
        "hianime",
        {
          anime: { audio: "original", subtitle: "en" },
          series: { audio: "original", subtitle: "none" },
          movie: { audio: "original", subtitle: "en" },
        },
        "youtube",
      ),
      mode: "youtube" as const,
      provider: "videasy",
    };
    const providerRegistry = {
      get: (id: string) =>
        id === "youtube"
          ? {
              metadata: {
                id: "youtube",
                name: "YouTube",
                isAnimeProvider: false,
                isYoutubeProvider: true,
              },
            }
          : {
              metadata: {
                id: "videasy",
                name: "Videasy",
                isAnimeProvider: false,
                isYoutubeProvider: false,
              },
            },
      getDefaultForMode: () => ({
        metadata: {
          id: "youtube",
          name: "YouTube",
          isAnimeProvider: false,
          isYoutubeProvider: true,
        },
      }),
    };

    expect(resolveProviderIdForSessionLane(state, providerRegistry as never)).toBe("youtube");

    const dispatches: Array<{ type: string; provider?: string }> = [];
    const stateManager = {
      getState: () => state,
      dispatch: (event: { type: string; provider?: string }) => {
        dispatches.push(event);
      },
    };

    expect(ensureSessionProviderMatchesLane(stateManager, providerRegistry as never)).toBe(
      "youtube",
    );
    expect(dispatches).toEqual([{ type: "SET_PROVIDER", provider: "youtube" }]);
  });
});
