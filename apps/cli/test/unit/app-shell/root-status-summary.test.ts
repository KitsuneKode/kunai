import { describe, expect, test } from "bun:test";

import { buildRootStatusSummary } from "@/app-shell/root-status-summary";
import { createInitialState } from "@/domain/session/SessionState";

describe("buildRootStatusSummary", () => {
  test("summarizes active playback with title, episode, subtitles, and chain state", () => {
    const base = createInitialState("vidking", "hianime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });
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

  test("uses hardsub inventory in the root playback subtitle badge", () => {
    const base = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });
    const summary = buildRootStatusSummary({
      state: {
        ...base,
        mode: "anime",
        provider: "allanime",
        view: "playback",
        playbackStatus: "playing",
        currentTitle: {
          id: "demo",
          name: "The Ramparts of Ice",
          type: "series",
        },
        currentEpisode: {
          season: 1,
          episode: 6,
        },
        stream: {
          url: "https://example.com/master.m3u8",
          headers: {},
          timestamp: 1,
          providerResolveResult: {
            providerId: "allanime",
            selectedStreamId: "sub-en",
            streams: [
              {
                id: "sub-en",
                providerId: "allanime",
                sourceId: "source-a",
                protocol: "hls",
                qualityLabel: "1080p",
                qualityRank: 1080,
                audioLanguages: ["ja"],
                hardSubLanguage: "en",
                url: "https://example.com/master.m3u8",
                headers: {},
                confidence: 0.9,
                cachePolicy: {
                  ttlClass: "stream-manifest",
                  scope: "local",
                  keyParts: [],
                },
              },
            ],
            sources: [],
            subtitles: [],
            trace: {
              id: "trace-1",
              startedAt: new Date().toISOString(),
              cacheHit: false,
              title: { id: "demo", kind: "series", title: "The Ramparts of Ice" },
              steps: [],
              failures: [],
            },
            failures: [],
          },
        },
      },
      currentViewLabel: "playback",
      rootStatus: "playing",
    });

    expect(summary.header.label).toBe("playing · hardsub en");
    expect(summary.header.tone).toBe("success");
    expect(summary.badges.map((badge) => badge.label)).toContain("hardsub en");
  });

  test("keeps idle search state compact when no title is selected", () => {
    const base = createInitialState("vidking", "hianime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });
    const summary = buildRootStatusSummary({
      state: {
        ...base,
        searchState: "loading",
      },
      currentViewLabel: "search",
      rootStatus: "searching",
    });

    expect(summary.header.label).toBe("searching");
    expect(summary.header.tone).toBe("warning");
    expect(summary.badges.map((badge) => badge.label)).toEqual([
      "series",
      "vidking",
      "search",
      "subs off",
    ]);
  });

  test("surfaces playback problem state as a compact badge", () => {
    const base = createInitialState("vidking", "hianime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });
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

  test("uses plain language for download status badges", () => {
    const base = createInitialState("vidking", "hianime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });
    const summary = buildRootStatusSummary({
      state: base,
      currentViewLabel: "home",
      rootStatus: "ready",
      downloadStatus: "2 active  ·  1 failed  ·  4 completed",
    });

    expect(summary.badges.map((badge) => badge.label)).toContain(
      "downloads 2 active  ·  1 failed  ·  4 completed",
    );
  });
});
