import { describe, expect, test } from "bun:test";

import {
  applyMediaItemSessionRouting,
  playbackIntentFromMediaItem,
} from "@/app/notification-media-session";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";

const seriesItem: MediaItemIdentity = {
  mediaKind: "series",
  titleId: "tmdb:42",
  title: "Example Series",
  season: 2,
  episode: 4,
};

function createRoutingContainer() {
  const dispatches: unknown[] = [];
  return {
    dispatches,
    container: {
      config: {
        getRaw: () => ({ titleProviderPreferences: {} }),
        animeProvider: "allanime",
      },
      providerRegistry: {
        get: (id: string) =>
          id === "vidking" ? { metadata: { id: "vidking", isAnimeProvider: false } } : null,
      },
      stateManager: {
        getState: () => ({ provider: "default" }),
        dispatch: (event: unknown) => {
          dispatches.push(event);
        },
      },
    },
  };
}

describe("notification-media-session", () => {
  test("playbackIntentFromMediaItem maps title and episode", () => {
    const intent = playbackIntentFromMediaItem(seriesItem);
    expect(intent.title).toEqual({
      id: "tmdb:42",
      type: "series",
      name: "Example Series",
    });
    expect(intent.episode).toEqual({ season: 2, episode: 4 });
  });

  test("applyMediaItemSessionRouting uses provider hints when no title preference exists", () => {
    const { container, dispatches } = createRoutingContainer();

    applyMediaItemSessionRouting(container as never, {
      ...seriesItem,
      providerHints: [{ providerId: "vidking" }],
    });

    expect(dispatches).toEqual([
      {
        type: "SET_MODE",
        mode: "series",
        provider: "vidking",
      },
    ]);
  });

  test("applyMediaItemSessionRouting switches to anime mode for anime items", () => {
    const { container, dispatches } = createRoutingContainer();

    applyMediaItemSessionRouting(container as never, {
      mediaKind: "anime",
      titleId: "mal:1",
      title: "Frieren",
    });

    expect(dispatches).toEqual([
      {
        type: "SET_MODE",
        mode: "anime",
        provider: "allanime",
      },
    ]);
  });
});
