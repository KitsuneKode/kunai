import { describe, expect, test } from "bun:test";

import { createPlaybackRunState } from "@/app/playback/playback-run-state";
import { createPlaybackSessionState } from "@/app/playback/playback-session-controller";
import { startFromBeginning } from "@/app/playback/playback-start-intent";

describe("createPlaybackRunState", () => {
  test("seeds the session and start intent and zero-values every queued field", () => {
    const playbackSession = createPlaybackSessionState({ autoNextEnabled: true });
    const pendingStart = startFromBeginning();

    const run = createPlaybackRunState({ playbackSession, pendingStart });

    expect(run.playbackSession).toBe(playbackSession);
    expect(run.pendingStart).toBe(pendingStart);
    expect(run).toMatchObject({
      sessionSoftProviderId: null,
      pendingSourceRefreshAction: null,
      pendingRecomputeSources: false,
      autoSourceRecoverAttempts: 0,
      autoRecoverEpisodeKey: null,
      episodePlaybackSourceOverride: null,
      localEpisodeTiming: null,
      localPlaybackJobId: null,
    });
  });

  test("returns an independently mutable object per call", () => {
    const base = {
      playbackSession: createPlaybackSessionState({ autoNextEnabled: false }),
      pendingStart: startFromBeginning(),
    };

    const first = createPlaybackRunState(base);
    const second = createPlaybackRunState(base);

    first.pendingRecomputeSources = true;
    first.autoSourceRecoverAttempts = 3;
    first.sessionSoftProviderId = "allanime";

    expect(second.pendingRecomputeSources).toBe(false);
    expect(second.autoSourceRecoverAttempts).toBe(0);
    expect(second.sessionSoftProviderId).toBeNull();
  });
});
