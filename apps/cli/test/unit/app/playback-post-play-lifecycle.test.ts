import { describe, expect, test } from "bun:test";

import type { EpisodePrefetchHandle } from "@/app/playback/episode-prefetch";
import {
  preparePostPlaybackSurface,
  teardownPlaybackForPostPlayExit,
} from "@/app/playback/playback-post-play-lifecycle";

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

  test("teardownPlaybackForPostPlayExit prepares the surface, drains title switch, then releases mpv", async () => {
    const events: string[] = [];
    await teardownPlaybackForPostPlayExit(
      createContainer(events),
      createPrefetch(events),
      new AbortController(),
    );

    // The title-selection drain is teardown-only — preparePostPlaybackSurface
    // must not consume it ahead of the post-play menu's entry check, so it has
    // to land after the prepare block's own drains.
    const titleDrain = events.indexOf("control:consume-title");
    expect(titleDrain).toBeGreaterThan(events.indexOf("control:consume-episode"));
    expect(events.at(-2)).toBe("control:consume-title");
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
      consumePendingTitleSelection() {
        events.push("control:consume-title");
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
