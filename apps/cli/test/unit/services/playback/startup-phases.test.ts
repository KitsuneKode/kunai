import { describe, expect, test } from "bun:test";

import {
  createPlaybackStartupTimeline,
  type PlaybackStartupStage,
  summarizeStartupPhases,
} from "@/services/playback/playback-startup-timeline";

// Build a timeline by marking stages at explicit absolute times (ms).
function timelineAt(marks: ReadonlyArray<readonly [PlaybackStartupStage, number]>) {
  const timeline = createPlaybackStartupTimeline({ startedAtMs: 0, now: () => 0 });
  for (const [stage, atMs] of marks) timeline.mark(stage, atMs);
  return timeline.snapshot();
}

describe("summarizeStartupPhases", () => {
  test("returns null until a first frame is observed", () => {
    const snapshot = timelineAt([
      ["resolve-started", 0],
      ["resolve-complete", 200],
      ["mpv-process-started", 600],
    ]);
    expect(summarizeStartupPhases(snapshot)).toBeNull();
  });

  test("buckets phases and names the dominant cost (slow resolve)", () => {
    const snapshot = timelineAt([
      ["resolve-started", 100],
      ["resolve-complete", 1800], // 1700ms scrape — the stall
      ["player-launch", 1850],
      ["mpv-process-started", 2050], // 200ms spawn
      ["ipc-connected", 2150],
      ["first-progress", 2500], // 450ms buffer
    ]);
    const phases = summarizeStartupPhases(snapshot);
    expect(phases).not.toBeNull();
    expect(phases?.resolveMs).toBe(1700);
    expect(phases?.launchMs).toBe(300); // player-launch → ipc-connected
    expect(phases?.firstFrameMs).toBe(450); // process-started → first-progress
    expect(phases?.totalMs).toBe(2500);
    expect(phases?.dominant).toBe("resolve");
  });

  test("dominant = first-frame when buffering is the slow part (warm prefetch)", () => {
    const snapshot = timelineAt([
      ["resolve-started", 0],
      ["resolve-complete", 30], // prefetched — instant
      ["player-launch", 40],
      ["mpv-process-started", 250], // spawn
      ["first-progress", 1900], // long CDN buffer
    ]);
    expect(summarizeStartupPhases(snapshot)?.dominant).toBe("first-frame");
  });
});
