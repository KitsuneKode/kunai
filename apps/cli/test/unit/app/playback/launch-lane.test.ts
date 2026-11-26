import { describe, expect, test } from "bun:test";

import { alignSessionLane, shellModeForQueueIntent } from "@/app/playback/launch-lane";
import { createInitialState, reduceState } from "@/domain/session/SessionState";
import type { SessionState, StateTransition } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

class TestSessionStateManager implements SessionStateManager {
  private state = createInitialState("vidking", "allanime", {
    anime: { audio: "original", subtitle: "en" },
    series: { audio: "original", subtitle: "none" },
    movie: { audio: "original", subtitle: "en" },
  });

  getState(): SessionState {
    return this.state;
  }

  dispatch(transition: StateTransition): void {
    this.state = reduceState(this.state, transition);
  }

  subscribe(): () => void {
    return () => {};
  }

  initialize(): void {}
}

const LANES = new Map([
  ["vidking", { isAnimeProvider: false, isYoutubeProvider: false }],
  ["miruro", { isAnimeProvider: true, isYoutubeProvider: false }],
  ["youtube", { isAnimeProvider: false, isYoutubeProvider: true }],
]);

function containerIn(mode: "series" | "anime" | "youtube") {
  const stateManager = new TestSessionStateManager();
  stateManager.dispatch({ type: "SET_DEFAULT_PROVIDER", mode: "youtube", provider: "youtube" });
  if (mode !== "series") {
    stateManager.dispatch({
      type: "SET_MODE",
      mode,
      provider: stateManager.getState().defaultProviders[mode],
    });
  }
  const container = {
    stateManager,
    config: { getRaw: () => DEFAULT_CONFIG },
    providerRegistry: {
      get: (id: string) => {
        const lane = LANES.get(id);
        return lane ? { metadata: { id, ...lane } } : undefined;
      },
    },
  };
  // SAFETY: alignSessionLane reads only stateManager, config.getRaw and providerRegistry.get.
  return { stateManager, container: container as never };
}

describe("alignSessionLane", () => {
  test("an anime queue row opened in series mode moves to the anime lane (Sol #4)", () => {
    const { stateManager, container } = containerIn("series");

    alignSessionLane(container, { mode: shellModeForQueueIntent({ mediaKind: "anime" }) });

    expect(stateManager.getState().mode).toBe("anime");
    expect(stateManager.getState().provider).toBe("allanime");
  });

  test("a TMDB share link in anime mode and a YouTube link in series mode change lane (Sol #5)", () => {
    const fromAnime = containerIn("anime");
    alignSessionLane(fromAnime.container, { mode: "series" });
    expect(fromAnime.stateManager.getState().mode).toBe("series");
    expect(fromAnime.stateManager.getState().provider).toBe("vidking");

    const fromSeries = containerIn("series");
    alignSessionLane(fromSeries.container, {
      mode: shellModeForQueueIntent({ mediaKind: "video" }),
    });
    expect(fromSeries.stateManager.getState().mode).toBe("youtube");
  });

  test("a hinted provider is used only when it serves the target lane", () => {
    const fits = containerIn("series");
    alignSessionLane(fits.container, { mode: "anime", preferredProviderId: "miruro" });
    expect(fits.stateManager.getState().provider).toBe("miruro");

    const crossLane = containerIn("anime");
    alignSessionLane(crossLane.container, { mode: "series", preferredProviderId: "miruro" });
    expect(crossLane.stateManager.getState().mode).toBe("series");
    expect(crossLane.stateManager.getState().provider).toBe("vidking");
  });

  test("a session already in the lane keeps its provider", () => {
    const { stateManager, container } = containerIn("anime");
    stateManager.dispatch({ type: "SET_PROVIDER", provider: "miruro" });

    alignSessionLane(container, { mode: "anime" });

    expect(stateManager.getState().provider).toBe("miruro");
  });
});
