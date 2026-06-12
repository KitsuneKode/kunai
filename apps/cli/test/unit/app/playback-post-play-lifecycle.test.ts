import { describe, expect, test } from "bun:test";

import type { EpisodePrefetchHandle } from "@/app/episode-prefetch";
import {
  preparePostPlaybackSurface,
  teardownPlaybackForPostPlayExit,
} from "@/app/playback-post-play-lifecycle";

describe("playback post-play lifecycle", () => {
  test("preparePostPlaybackSurface aborts playback work and clears pending player actions", () => {
    const events: string[] = [];
    const abort = new AbortController();
    const container = createContainer(events);
    const prefetch = createPrefetch(events);

    preparePostPlaybackSurface(container, prefetch, abort);

    expect(abort.signal.aborted).toBe(true);
    expect(events).toEqual([
      "prefetch:suspend:post-playback-menu",
      "control:consume-last-action",
      "control:consume-stream",
      "control:consume-episode",
      "state:SET_PLAYBACK_STATUS:idle",
    ]);
  });

  test("teardownPlaybackForPostPlayExit prepares the surface before releasing mpv", async () => {
    const events: string[] = [];
    await teardownPlaybackForPostPlayExit(
      createContainer(events),
      createPrefetch(events),
      new AbortController(),
    );

    expect(events.at(-1)).toBe("player:release");
  });
});

function createContainer(events: string[]) {
  return {
    player: {
      async releasePersistentSession() {
        events.push("player:release");
      },
    },
    playerControl: {
      consumeLastAction() {
        events.push("control:consume-last-action");
        return null;
      },
      consumePendingStreamSelection() {
        events.push("control:consume-stream");
        return null;
      },
      consumePendingEpisodeSelection() {
        events.push("control:consume-episode");
        return null;
      },
    },
    stateManager: {
      dispatch(action: { type: string; status?: string }) {
        events.push(`state:${action.type}:${action.status ?? ""}`);
      },
    },
  };
}

function createPrefetch(events: string[]) {
  return {
    suspend(reason: string) {
      events.push(`prefetch:suspend:${reason}`);
    },
  } as Pick<EpisodePrefetchHandle, "suspend"> as EpisodePrefetchHandle;
}
