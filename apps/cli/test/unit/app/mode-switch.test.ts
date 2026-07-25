import { describe, expect, test } from "bun:test";

import { getModeSwitchTarget, setSessionLane, switchSessionMode } from "@/app/session/mode-switch";
import { createInitialState } from "@/domain/session/SessionState";

describe("getModeSwitchTarget", () => {
  test("switches series mode to the configured anime provider", () => {
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });

    expect(getModeSwitchTarget(state)).toEqual({
      mode: "anime",
      provider: "allanime",
    });
  });

  test("switches anime mode to the configured series provider", () => {
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      mode: "anime" as const,
      provider: "allanime",
      defaultProviders: {
        series: "cineby",
        anime: "allanime",
        youtube: "youtube",
      },
    };

    expect(getModeSwitchTarget(state)).toEqual({
      mode: "youtube",
      provider: "youtube",
    });
  });

  test("switches youtube mode to the configured series provider", () => {
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      mode: "youtube" as const,
      provider: "youtube",
      defaultProviders: {
        series: "cineby",
        anime: "allanime",
        youtube: "youtube",
      },
    };

    expect(getModeSwitchTarget(state)).toEqual({
      mode: "series",
      provider: "cineby",
    });
  });
});

describe("setSessionLane", () => {
  test("falls back to the lane default when configured provider is stale", () => {
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      defaultProviders: {
        series: "vidking",
        anime: "allanime",
        youtube: "vidking",
      },
    };
    const events: unknown[] = [];
    const stateManager = {
      getState: () => state,
      dispatch: (event: unknown) => events.push(event),
    };

    setSessionLane(stateManager as never, "youtube", providerRegistry());

    expect(events).toEqual([{ type: "SET_MODE", mode: "youtube", provider: "youtube" }]);
  });
});

describe("switchSessionMode", () => {
  test("uses provider-lane correction while cycling modes", () => {
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      mode: "anime" as const,
      provider: "allanime",
      defaultProviders: {
        series: "vidking",
        anime: "allanime",
        youtube: "vidking",
      },
    };
    const events: unknown[] = [];
    const stateManager = {
      getState: () => state,
      dispatch: (event: unknown) => events.push(event),
    };

    switchSessionMode(stateManager as never, providerRegistry());

    expect(events).toEqual([{ type: "SET_MODE", mode: "youtube", provider: "youtube" }]);
  });
});

function providerRegistry() {
  return {
    get: (providerId: string) => {
      if (providerId === "youtube") {
        return {
          metadata: {
            id: "youtube",
            name: "YouTube",
            isAnimeProvider: false,
            isYoutubeProvider: true,
          },
        };
      }
      if (providerId === "allanime") {
        return {
          metadata: {
            id: "allanime",
            name: "AllAnime",
            isAnimeProvider: true,
            isYoutubeProvider: false,
          },
        };
      }
      return {
        metadata: {
          id: providerId,
          name: providerId,
          isAnimeProvider: false,
          isYoutubeProvider: false,
        },
      };
    },
    getDefaultForMode: (mode: "series" | "anime" | "youtube") => ({
      metadata: {
        id: mode === "anime" ? "allanime" : mode === "youtube" ? "youtube" : "vidking",
        name: mode,
        isAnimeProvider: mode === "anime",
        isYoutubeProvider: mode === "youtube",
      },
    }),
  };
}

describe("reverse mode cycling", () => {
  const stateInMode = (mode: "series" | "anime" | "youtube") => ({
    ...createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    }),
    mode,
    defaultProviders: { series: "videasy", anime: "allanime", youtube: "youtube" },
  });

  test("steps backward through the cycle and wraps below the first mode", () => {
    // ⇧Tab is what makes a three-mode cycle usable: without it, reaching the
    // previous mode means walking the whole ring forward.
    expect(getModeSwitchTarget(stateInMode("youtube"), "backward").mode).toBe("anime");
    expect(getModeSwitchTarget(stateInMode("anime"), "backward").mode).toBe("series");
    // The wrap is the case a naive `index - 1` gets wrong: it lands on -1.
    expect(getModeSwitchTarget(stateInMode("series"), "backward").mode).toBe("youtube");
  });

  test("forward stays the default so Tab is unchanged", () => {
    expect(getModeSwitchTarget(stateInMode("series")).mode).toBe("anime");
    expect(getModeSwitchTarget(stateInMode("series"), "forward").mode).toBe("anime");
  });
});
