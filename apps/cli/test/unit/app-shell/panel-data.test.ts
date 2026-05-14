import { describe, expect, test } from "bun:test";

import {
  buildAboutPanelLines,
  buildDiagnosticsPanelLines,
  buildHistoryPickerOptions,
  buildHelpPanelLines,
  buildHistoryPanelLines,
  buildProviderPickerOptions,
} from "@/app-shell/panel-data";
import { createInitialState } from "@/domain/session/SessionState";

describe("panel-data", () => {
  test("buildHelpPanelLines returns stable guidance", () => {
    const lines = buildHelpPanelLines();
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.some((line) => line.label === "─── Panels")).toBe(true);
    expect(lines.some((line) => line.label === "Ctrl+W")).toBe(true);
  });

  test("buildAboutPanelLines includes default mode summary", () => {
    const lines = buildAboutPanelLines({
      config: {
        defaultMode: "anime",
        provider: "braflix",
        animeProvider: "allanime",
        subLang: "en",
        animeLang: "sub",
        animeLanguageProfile: { audio: "original", subtitle: "en" },
        seriesLanguageProfile: { audio: "original", subtitle: "none" },
        movieLanguageProfile: { audio: "original", subtitle: "en" },
        animeTitlePreference: "english",
        headless: true,
        showMemory: false,
        autoNext: true,
        resumeStartChoicePrompt: true,
        skipRecap: true,
        skipIntro: true,
        skipPreview: true,
        skipCredits: true,
        footerHints: "detailed",
        quitNearEndBehavior: "continue",
        quitNearEndThresholdMode: "credits-or-90-percent",
        mpvKunaiScriptPath: "",
        mpvKunaiScriptOpts: {},
        mpvInProcessStreamReconnect: true,
        mpvInProcessStreamReconnectMaxAttempts: 3,
        discoverShowOnStartup: false,
        discoverMode: "auto",
        discoverItemLimit: 24,
        recommendationRailEnabled: true,
        minimalMode: false,
        presenceProvider: "off",
        presencePrivacy: "full",
        presenceDiscordClientId: "",
        downloadsEnabled: false,
        autoDownload: "off",
        autoDownloadNextCount: 1,
        autoCleanupWatched: false,
        autoCleanupGraceDays: 7,
        onboardingVersion: 0,
        downloadPath: "",
        downloadOnboardingDismissed: false,
      },
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
    });

    expect(lines.find((line) => line.label === "Default startup mode")?.detail).toContain("anime");
    expect(lines.find((line) => line.label === "Downloads")?.detail).toBe("off");
  });

  test("buildDiagnosticsPanelLines surfaces missing subtitles clearly", () => {
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "en" },
      movie: { audio: "original", subtitle: "en" },
    });
    const lines = buildDiagnosticsPanelLines({
      state,
      recentEvents: [],
      presenceSnapshot: {
        provider: "discord",
        status: "unavailable",
        privacy: "full",
        clientIdSource: "missing",
        canConnect: false,
        detail: "missing Discord application client id",
      },
    });

    expect(lines.find((line) => line.label === "State")?.detail).toBe("not resolved yet");
    expect(lines.find((line) => line.label === "Evidence")?.tone).toBe("warning");
    expect(lines.find((line) => line.label === "Status")?.detail).toContain(
      "missing Discord application client id",
    );
    expect(lines.find((line) => line.label === "Status")?.tone).toBe("warning");
  });

  test("buildDiagnosticsPanelLines surfaces the latest playback problem", () => {
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      playbackProblem: {
        stage: "mpv",
        severity: "recoverable",
        cause: "expired-stream",
        userMessage: "The stream expired.",
        recommendedAction: "refresh",
        secondaryActions: ["diagnostics"],
      },
    } as const;
    const lines = buildDiagnosticsPanelLines({
      state,
      recentEvents: [],
    });

    const problem = lines.find((line) => line.label === "Playback problem");
    expect(problem?.detail).toContain("expired-stream");
    expect(problem?.detail).toContain("refresh");
    expect(problem?.tone).toBe("warning");
  });

  test("buildDiagnosticsPanelLines surfaces direct provider trace summary", () => {
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      provider: "rivestream",
    } as const;
    const lines = buildDiagnosticsPanelLines({
      state,
      recentEvents: [
        {
          timestamp: 3000,
          level: "info",
          category: "provider",
          operation: "provider",
          message: "Provider resolve trace completed",
          context: {
            trace: {
              id: "trace-1",
              startedAt: "2026-05-06T00:00:00.000Z",
              endedAt: "2026-05-06T00:00:01.100Z",
              title: { id: "1396", name: "Breaking Bad", type: "series" },
              selectedProviderId: "rivestream",
              selectedStreamId: "stream-1",
              cacheHit: false,
              runtime: "direct-http",
              steps: [
                {
                  at: "2026-05-06T00:00:01.100Z",
                  stage: "provider",
                  message: "Resolved Rivestream through local MurmurHash",
                  providerId: "rivestream",
                  attributes: { streams: 2 },
                },
              ],
              failures: [],
            },
            streamCandidates: 2,
            subtitleCandidates: 3,
          },
        },
      ],
    });

    const provider = lines.find((line) => line.label === "Provider");
    expect(provider?.detail).toContain("rivestream · direct-http");
    expect(provider?.detail).toContain("cache miss");
    expect(provider?.detail).toContain("2 streams");
    expect(provider?.tone).toBe("success");
  });

  test("buildHistoryPanelLines sorts newest entries first", () => {
    const lines = buildHistoryPanelLines([
      [
        "older",
        {
          title: "Older Show",
          type: "series",
          season: 1,
          episode: 2,
          timestamp: 120,
          duration: 300,
          completed: false,
          provider: "vidking",
          watchedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      [
        "newer",
        {
          title: "Newer Show",
          type: "series",
          season: 2,
          episode: 4,
          timestamp: 180,
          duration: 300,
          completed: false,
          provider: "allanime",
          watchedAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    ]);

    expect(lines[0]?.label).toContain("Newer Show");
  });

  test("buildProviderPickerOptions marks current provider", () => {
    const options = buildProviderPickerOptions({
      currentProvider: "allanime",
      providers: [
        {
          id: "allanime",
          name: "AllAnime",
          description: "Anime provider",
          recommended: false,
          isAnimeProvider: true,
        },
        {
          id: "cineby-anime",
          name: "Cineby Anime",
          description: "Fallback anime provider",
          recommended: false,
          isAnimeProvider: true,
        },
      ],
    });

    expect(options[0]?.label).toContain("current");
    expect(options[1]?.label).not.toContain("current");
  });

  test("buildHistoryPickerOptions sorts newest entries first and keeps ids", () => {
    const options = buildHistoryPickerOptions([
      [
        "older",
        {
          title: "Older Show",
          type: "series",
          season: 1,
          episode: 2,
          timestamp: 120,
          duration: 300,
          completed: false,
          provider: "vidking",
          watchedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      [
        "newer",
        {
          title: "Newer Show",
          type: "series",
          season: 2,
          episode: 4,
          timestamp: 180,
          duration: 300,
          completed: false,
          provider: "allanime",
          watchedAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    ]);

    expect(options[0]?.value).toBe("newer");
    expect(options[0]?.label).toContain("Newer Show");
    expect(options[1]?.value).toBe("older");
  });
});
