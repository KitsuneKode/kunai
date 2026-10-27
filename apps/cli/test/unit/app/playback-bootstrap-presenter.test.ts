import { describe, expect, test } from "bun:test";

import {
  buildPlaybackBootstrapPresentation,
  formatBootstrapInventorySummary,
  latestPlaybackStartupStage,
  mapStartupStageToLoadingStage,
} from "@/app/playback/playback-bootstrap-presenter";
import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";

function timelineEvent(stage: string): DiagnosticEvent {
  return {
    timestamp: Date.now(),
    level: "info",
    category: "playback",
    operation: "playback.startup.timeline",
    message: `Playback startup ${stage}`,
    context: { stage },
  };
}

describe("playback-bootstrap-presenter", () => {
  test("keeps source discovery active until resolve actually completes", () => {
    expect(mapStartupStageToLoadingStage("resolve-started", "loading")).toBe("finding-stream");
    expect(mapStartupStageToLoadingStage("player-ready", "loading")).toBe("starting-playback");
  });

  test("new episode progress does not inherit the prior episode's completed rail", () => {
    expect(
      latestPlaybackStartupStage([
        timelineEvent("first-progress"),
        timelineEvent("episode-bootstrap-started"),
        timelineEvent("resolve-started"),
      ]),
    ).toBe("resolve-started");
  });

  test("picks latest startup stage from diagnostics", () => {
    const events = [
      timelineEvent("resolve-started"),
      timelineEvent("subtitle-attached"),
      timelineEvent("player-launch"),
    ];
    expect(latestPlaybackStartupStage(events)).toBe("subtitle-attached");
  });

  test("builds presentation from playback status and timeline", () => {
    const presentation = buildPlaybackBootstrapPresentation({
      playbackStatus: "loading",
      playbackDetail: "Opening provider stream",
      recentEvents: [timelineEvent("stream-prepared")],
    });
    expect(presentation.operation).toBe("loading");
    expect(presentation.stage).toBe("preparing-player");
    expect(presentation.stageDetail).toBe("Opening provider stream");
  });

  test("formats bootstrap inventory summary", () => {
    const summary = formatBootstrapInventorySummary({
      providerResolveResult: {
        streams: [{ qualityLabel: "1080p" }, { qualityLabel: "720p" }, { qualityLabel: "ORG" }],
        subtitles: [{}, {}],
        sources: [{ label: "Luffy" }],
      },
    });
    expect(summary).toBe("Luffy · 1080p/720p/ORG · 2 subs");
  });
});
