import { expect, test } from "bun:test";

import {
  createPlaybackStartupTimeline,
  formatPlaybackStartupTimeline,
} from "@/services/playback/playback-startup-timeline";

test("playback startup timeline records elapsed and delta timings", () => {
  const timeline = createPlaybackStartupTimeline({
    startedAtMs: 1_000,
    source: { providerId: "vidking", sourceId: "source:vidking:auto", host: "cdn.example" },
  });

  timeline.mark("episode-bootstrap-started", 1_010);
  timeline.mark("episode-context-ready", 1_050);
  timeline.mark("resolve-started", 1_100);
  timeline.mark("resolve-complete", 1_450);
  timeline.mark("timing-wait-started", 1_460);
  timeline.mark("timing-ready", 1_500);
  timeline.mark("player-launch", 1_700);
  timeline.mark("first-progress", 2_200);

  expect(timeline.snapshot()).toEqual({
    startedAtMs: 1_000,
    source: { providerId: "vidking", sourceId: "source:vidking:auto", host: "cdn.example" },
    marks: [
      { stage: "episode-bootstrap-started", atMs: 1_010, elapsedMs: 10, deltaMs: 10 },
      { stage: "episode-context-ready", atMs: 1_050, elapsedMs: 50, deltaMs: 40 },
      { stage: "resolve-started", atMs: 1_100, elapsedMs: 100, deltaMs: 50 },
      { stage: "resolve-complete", atMs: 1_450, elapsedMs: 450, deltaMs: 350 },
      { stage: "timing-wait-started", atMs: 1_460, elapsedMs: 460, deltaMs: 10 },
      { stage: "timing-ready", atMs: 1_500, elapsedMs: 500, deltaMs: 40 },
      { stage: "player-launch", atMs: 1_700, elapsedMs: 700, deltaMs: 200 },
      { stage: "first-progress", atMs: 2_200, elapsedMs: 1_200, deltaMs: 500 },
    ],
  });
});

test("playback startup timeline ignores duplicate marks and formats compactly", () => {
  const timeline = createPlaybackStartupTimeline({ startedAtMs: 0 });

  timeline.mark("resolve-started", 50);
  timeline.mark("resolve-started", 500);
  timeline.mark("first-progress", 1_250);

  expect(timeline.snapshot().marks).toHaveLength(2);
  expect(formatPlaybackStartupTimeline(timeline.snapshot())).toBe(
    "resolve-started 50ms (+50ms) -> first-progress 1.3s (+1.2s)",
  );
});
