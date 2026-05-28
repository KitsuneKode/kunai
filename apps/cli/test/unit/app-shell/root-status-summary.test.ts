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

    expect(summary.header.label).toBe("Playing · subs selected");
    expect(summary.header.tone).toBe("success");
    // Crumb includes mode · provider · title · episode during active playback
    expect(summary.crumb).toContain("anime");
    expect(summary.crumb).toContain("hianime");
    expect(summary.crumb).toContain("Frieren");
    expect(summary.crumb).toContain("S02E04");
    // autoplaySessionPaused fires as the alert (playbackProblem is null)
    expect(summary.alert?.text).toBe("⚠ autoplay paused");
    expect(summary.alert?.tone).toBe("warning");
  });

  test("uses hardsub inventory in the root playback subtitle header", () => {
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
            status: "resolved",
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

    expect(summary.header.label).toBe("Playing · hardsub en");
    expect(summary.header.tone).toBe("success");
    expect(summary.crumb).toContain("hardsub en");
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
    // Idle: crumb is just mode · provider, no title or episode
    expect(summary.crumb).toBe("series · vidking");
    expect(summary.alert).toBeNull();
  });

  test("carries active notifications in the crumb bell, not a persistent alert", () => {
    const base = createInitialState("vidking", "hianime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });
    const summary = buildRootStatusSummary({
      state: base,
      currentViewLabel: "search",
      rootStatus: "ready",
      notificationCount: 3,
      newEpisodeNotificationCount: 2,
    });

    // The bell in the crumb is the standing signal; the alert slot stays empty
    // so there is no persistent "N notifications" line under the header.
    expect(summary.crumb).toContain("🔔 2 new");
    expect(summary.alert).toBeNull();
  });

  test("surfaces playback problem state as an alert", () => {
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

    expect(summary.alert?.text).toBe("⚠ issue · expired-stream");
    expect(summary.alert?.tone).toBe("warning");
  });

  test("shows selected and active provider in the crumb when they differ", () => {
    const base = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });
    const summary = buildRootStatusSummary({
      state: {
        ...base,
        provider: "vidking",
        playbackStatus: "playing",
        currentTitle: { id: "demo", name: "Vincenzo", type: "series" },
        currentEpisode: { season: 1, episode: 5 },
        stream: {
          url: "https://example.com/master.m3u8",
          headers: {},
          timestamp: 1,
          providerResolveResult: {
            status: "resolved",
            providerId: "rivestream",
            streams: [],
            subtitles: [],
          },
        } as never,
      },
      currentViewLabel: "playback",
      rootStatus: "playing",
    });

    expect(summary.crumb).toContain("vidking→rivestream");
  });

  test("uses plain language for download status alert", () => {
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

    expect(summary.alert?.text).toBe("⬇ 2 active  ·  1 failed  ·  4 completed");
    expect(summary.alert?.tone).toBe("info");
  });
});
