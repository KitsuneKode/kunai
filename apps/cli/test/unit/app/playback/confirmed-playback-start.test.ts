import { describe, expect, test } from "bun:test";

import { confirmPlaybackStart } from "@/app/playback/confirmed-playback-start";
import {
  createPlaybackSessionState,
  transitionPlaybackSessionPhase,
} from "@/app/playback/playback-session-controller";

describe("confirmed playback start boundary", () => {
  test("keeps the session ready until confirmation, then transitions and acknowledges once", () => {
    const ready = transitionPlaybackSessionPhase(
      createPlaybackSessionState({ autoNextEnabled: true }),
      "stream-ready",
    );
    const events: string[] = [];

    expect(ready.phase).toBe("ready");

    const playing = confirmPlaybackStart({
      session: ready,
      transition: (session, event) => {
        events.push(event);
        return transitionPlaybackSessionPhase(session, event);
      },
      acknowledgeQueue: () => events.push("queue-acknowledged"),
    });

    expect(playing.phase).toBe("playing");
    expect(events).toEqual(["playback-started", "queue-acknowledged"]);
  });
});
