import { describe, expect, test } from "bun:test";

import { buildRootStatusSummary } from "@/app-shell/root-status-summary";
import { createInitialState } from "@/domain/session/SessionState";

describe("buildRootStatusSummary", () => {
  test("summarizes active playback with title, episode, subtitles, and chain state", () => {
    const base = createInitialState("vidking", "hianime");
    const summary = buildRootStatusSummary({
      state: {
        ...base,
        mode: "anime",
        provider: "hianime",
        view: "playback",
        playbackStatus: "playing",
        autoplaySessionPaused: true,
        currentTitle: {
          id: "demo",
          name: "Frieren",
          type: "series",
        },
        currentEpisode: {
          season: 2,
          episode: 4,
        },
        stream: {
          url: "https://example.com/master.m3u8",
          headers: {},
          subtitle: "https://example.com/sub.vtt",
          timestamp: 1,
        },
      },
      currentViewLabel: "playback",
      rootStatus: "playing",
    });

    expect(summary.header.label).toBe("playing · subs ready");
    expect(summary.header.tone).toBe("success");
    expect(summary.badges.map((badge) => badge.label)).toEqual([
      "anime",
      "hianime",
      "playback",
      "Frieren",
      "S02E04",
      "subs ready",
      "autoplay paused",
    ]);
  });

  test("keeps idle search state compact when no title is selected", () => {
    const base = createInitialState("vidking", "hianime");
    const summary = buildRootStatusSummary({
      state: {
        ...base,
        searchState: "loading",
      },
      currentViewLabel: "search",
      rootStatus: "searching",
    });

    expect(summary.header.label).toBe("searching");
    expect(summary.header.tone).toBe("neutral");
    expect(summary.badges.map((badge) => badge.label)).toEqual(["series", "vidking", "search"]);
  });

  test("surfaces playback problem state as a compact badge", () => {
    const base = createInitialState("vidking", "hianime");
    const summary = buildRootStatusSummary({
      state: {
        ...base,
        playbackProblem: {
          stage: "mpv",
          severity: "recoverable",
          cause: "expired-stream",
          userMessage: "The stream expired.",
          recommendedAction: "refresh",
          secondaryActions: ["diagnostics"],
        },
      },
      currentViewLabel: "playback",
      rootStatus: "error",
    });

    expect(summary.badges.find((badge) => badge.label === "issue expired-stream")?.tone).toBe(
      "warning",
    );
  });
});
