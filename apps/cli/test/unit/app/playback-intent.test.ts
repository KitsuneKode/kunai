import { describe, expect, test } from "bun:test";

import { PlaybackIntentBus } from "@/app/playback-intent";
import { createPlaybackIterationState } from "@/app/playback-iteration-state";
import { createPlaybackSessionState } from "@/app/playback-session-controller";

describe("PlaybackIntentBus", () => {
  test("drains published intents in order", () => {
    const bus = new PlaybackIntentBus();
    bus.publish({ type: "playback-action", action: "next" });
    bus.publish({ type: "provider-switch", seq: 2 });
    expect(bus.drain()).toEqual([
      { type: "playback-action", action: "next" },
      { type: "provider-switch", seq: 2 },
    ]);
    expect(bus.drain()).toEqual([]);
  });

  test("notifies subscribers on publish", () => {
    const bus = new PlaybackIntentBus();
    let calls = 0;
    bus.subscribe(() => {
      calls += 1;
    });
    bus.publish({ type: "cancel-active-work" });
    expect(calls).toBe(1);
  });
});

describe("PlaybackIterationState", () => {
  test("tracks local job provenance explicitly", () => {
    const state = createPlaybackIterationState({
      titleId: "tv:1",
      episode: { season: 1, episode: 1 },
      session: createPlaybackSessionState({ autoNextEnabled: false }),
      providerId: "videasy",
      sourceProvenance: "local",
      localJobId: "job-1",
    });
    expect(state.localJobId).toBe("job-1");
    expect(state.sourceProvenance).toBe("local");
  });
});
