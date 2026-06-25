import { describe, expect, test } from "bun:test";

import {
  buildAboutPanelLines,
  buildDiagnosticsPanelLines,
  buildHistoryPickerOptions,
  buildHelpPanelLines,
  buildHistoryPanelLines,
  buildProviderPickerOptions,
  groupHistoryByRecency,
} from "@/app-shell/panel-data";
import {
  buildHelpPanelCommandLines,
  HELP_PANEL_COMMAND_IDS,
} from "@/domain/session/command-registry";
import { createInitialState } from "@/domain/session/SessionState";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import type { HistoryProgress } from "@kunai/storage";
import type { ProviderResolveResult } from "@kunai/types";

describe("panel-data", () => {
  test("buildHelpPanelLines returns stable guidance", () => {
    const lines = buildHelpPanelLines();
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.some((line) => line.label === "─── Panels & commands")).toBe(true);
    expect(lines.some((line) => line.label === "Ctrl+W")).toBe(true);
  });

  test("buildHelpPanelLines documents the real mpv quality key (k), not an invented v", () => {
    const lines = buildHelpPanelLines();
    const quality = lines.find((line) => line.detail?.toLowerCase().includes("quality"));
    expect(quality?.label).toBe("k / K");
    // the old panel claimed a bare "v" for quality — it was never bound.
    expect(lines.some((line) => line.label === "v")).toBe(false);
  });

  test("buildHelpPanelLines slash commands come from the command registry", () => {
    const lines = buildHelpPanelLines();
    const registryLines = buildHelpPanelCommandLines();
    expect(registryLines.length).toBe(HELP_PANEL_COMMAND_IDS.length);
    for (const registryLine of registryLines) {
      expect(lines).toContainEqual({ label: registryLine.label, detail: registryLine.detail });
    }
    expect(lines.find((line) => line.label === "/history")?.detail).toContain("watch history");
    expect(lines.find((line) => line.label === "/watchlist")?.detail).toContain("Watchlist");
  });

  test("buildAboutPanelLines includes default mode summary", () => {
    const lines = buildAboutPanelLines({
      config: {
        ...DEFAULT_CONFIG,
        defaultMode: "anime",
        provider: "braflix",
        animeProvider: "allanime",
        skipRecap: true,
        skipPreview: true,
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

    expect(lines.find((line) => line.label === "Subtitles")?.detail).toContain("not resolved yet");
    expect(lines.find((line) => line.label === "Presence")?.detail).toContain("unavailable");
    expect(lines.find((line) => line.label === "Presence")?.tone).toBe("warning");
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

    const session = lines.find((line) => line.label === "Session");
    expect(session?.detail).toContain("expired-stream");
    expect(session?.detail).toContain("refresh");
    expect(session?.tone).toBe("error");
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
    expect(provider?.detail).toContain("rivestream");
    expect(provider?.detail).toContain("2 streams");
    expect(provider?.tone).toBe("success");
  });

  test("buildDiagnosticsPanelLines points to export commands instead of a smoke-test dump", () => {
    const lines = buildDiagnosticsPanelLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [],
    });

    expect(lines.some((line) => line.label === "/export-diagnostics")).toBe(true);
    expect(lines.some((line) => line.label === "/report-issue")).toBe(true);
    expect(lines.some((line) => line.label === "─── Smoke tests")).toBe(false);
  });

  test("buildDiagnosticsPanelLines renders provider timeline summaries", () => {
    const lines = buildDiagnosticsPanelLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [
        {
          timestamp: 1,
          level: "info",
          category: "provider",
          operation: "provider.resolve.timeline",
          message: "Recovered via Rivestream",
          traceId: "provider:abc",
          providerId: "rivestream",
          context: {
            status: "recovered",
            attempts: 2,
            attemptTimeline: [
              {
                providerId: "vidking",
                status: "failed",
                failureClass: "timeout",
              },
              {
                providerId: "rivestream",
                status: "succeeded",
              },
            ],
            primaryFailure: "VidKing timed out",
            failureClass: "timeout",
          },
        },
      ],
    });

    expect(lines.find((line) => line.label === "Provider")?.detail).toContain("rivestream");
    expect(lines.find((line) => line.label === "Resolve trace")?.detail).toContain(
      "vidking failed (timeout) -> rivestream succeeded",
    );
  });

  test("buildDiagnosticsPanelLines renders provider source attempts from timeline diagnostics", () => {
    const lines = buildDiagnosticsPanelLines({
      state: createInitialState("videasy", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [
        {
          timestamp: 1,
          level: "warn",
          category: "provider",
          operation: "provider.resolve.timeline",
          message: "Videasy did not produce a playable source",
          providerId: "videasy",
          context: {
            status: "failed",
            attempts: 1,
            sourceAttemptCount: 2,
            sourceAttempts: [
              {
                type: "source:start",
                message: "Trying Luffy",
                sourceId: "source:videasy:mb-flix",
                serverId: "mb-flix",
                at: "2026-06-21T00:00:01.000Z",
              },
              {
                type: "source:failed",
                message: "Luffy returned no playable candidates",
                sourceId: "source:videasy:mb-flix",
                failureClass: "candidate-empty",
                serverId: "mb-flix",
                at: "2026-06-21T00:00:02.000Z",
              },
            ],
          },
        },
      ],
    });

    const sourceAttempts = lines.find((line) => line.label === "Source attempts");
    expect(sourceAttempts?.detail).toContain("mb-flix failed");
    expect(sourceAttempts?.detail).toContain("candidate-empty");
    expect(sourceAttempts?.tone).toBe("warning");
  });

  test("buildDiagnosticsPanelLines renders playback startup timing summaries", () => {
    const lines = buildDiagnosticsPanelLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [
        {
          timestamp: 1,
          level: "info",
          category: "playback",
          operation: "playback.startup.timeline",
          message: "Playback startup first-progress",
          context: {
            stage: "first-progress",
            summary:
              "resolve-complete 420ms (+420ms) -> player-ready 1.4s (+980ms) -> first-progress 2.1s (+700ms)",
          },
        },
      ],
    });

    expect(lines.find((line) => line.label === "Playback startup")?.detail).toContain(
      "first-progress 2.1s",
    );
    expect(lines.find((line) => line.label === "Playback startup")?.tone).toBe("success");
  });

  test("buildDiagnosticsPanelLines surfaces correlated runtime evidence honestly", () => {
    const lines = buildDiagnosticsPanelLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [
        {
          timestamp: 4,
          level: "info",
          category: "subtitle",
          operation: "subtitle.attach.outcome",
          message: "Attached late subtitles",
          playbackCycleId: "cycle-42",
          providerAttemptId: "provider-42",
          traceId: "trace-42",
          context: {
            outcome: "attached",
            delivery: "late",
            attachedCount: 2,
          },
        },
        {
          timestamp: 3,
          level: "warn",
          category: "provider",
          operation: "provider.resolve.fallback",
          message: "Provider fallback started",
          playbackCycleId: "cycle-42",
          providerAttemptId: "provider-42",
          traceId: "trace-42",
          providerId: "rivestream",
          context: {
            fromProviderId: "vidking",
            toProviderId: "rivestream",
          },
        },
        {
          timestamp: 2,
          level: "warn",
          category: "provider",
          operation: "provider.resolve.attempt",
          message: "Provider resolve attempt failed",
          playbackCycleId: "cycle-42",
          providerAttemptId: "provider-42",
          traceId: "trace-42",
          providerId: "vidking",
          context: {
            phase: "failed",
            elapsedMs: 742,
            failureCode: "timeout",
          },
        },
        {
          timestamp: 1,
          level: "info",
          category: "playback",
          operation: "playback.startup.timeline",
          message: "Playback startup player-ready",
          playbackCycleId: "cycle-42",
          providerAttemptId: "provider-42",
          traceId: "trace-42",
          context: {
            stage: "player-ready",
            timeline: {
              startedAtMs: 0,
              marks: [
                { stage: "resolve-started", atMs: 100, elapsedMs: 100, deltaMs: 100 },
                { stage: "resolve-complete", atMs: 950, elapsedMs: 950, deltaMs: 850 },
                { stage: "player-ready", atMs: 1200, elapsedMs: 1200, deltaMs: 250 },
              ],
            },
          },
        },
      ],
      downloadSummary: null,
    });

    expect(lines).toContainEqual(
      expect.objectContaining({
        label: "Mode",
        detail: expect.stringContaining("cycle-42"),
      }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        label: "Playback startup",
        detail: expect.stringContaining("resolve-complete 850ms"),
      }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        label: "Resolve trace",
        detail: expect.stringContaining("vidking failed in 742ms"),
      }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        label: "Subtitles",
        detail: expect.stringContaining("late"),
      }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        label: "Downloads",
        detail: expect.stringContaining("queue idle"),
        tone: "neutral",
      }),
    );
  });

  test("buildDiagnosticsPanelLines summarizes resolved source inventory for support triage", () => {
    const providerResolveResult = {
      status: "resolved",
      providerId: "rivestream",
      selectedStreamId: "stream-1",
      streams: [
        {
          id: "stream-1",
          providerId: "rivestream",
          sourceId: "source-1",
          protocol: "hls",
          container: "m3u8",
          url: "https://cdn.example/private-stream.m3u8",
          confidence: 0.9,
          qualityLabel: "720p",
          audioLanguages: ["en"],
          cachePolicy: {
            ttlClass: "stream-manifest",
            scope: "local",
            keyParts: [],
          },
        },
      ],
      subtitles: [
        {
          id: "sub-en",
          providerId: "rivestream",
          sourceId: "source-1",
          url: "https://subs.example/private-en.vtt",
          language: "en",
          label: "English",
          source: "provider",
          confidence: 0.9,
          cachePolicy: {
            ttlClass: "subtitle-list",
            scope: "local",
            keyParts: [],
          },
        },
      ],
      trace: {
        id: "trace-1",
        startedAt: "2026-05-19T00:00:00.000Z",
        cacheHit: false,
        title: { id: "demo", kind: "series", title: "Demo" },
        steps: [],
        failures: [],
      },
      failures: [],
    } satisfies ProviderResolveResult;
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      stream: {
        url: "https://cdn.example/private-stream.m3u8",
        headers: {},
        subtitle: "https://subs.example/private-en.vtt",
        subtitleList: [
          {
            url: "https://subs.example/private-en.vtt",
            display: "English",
            language: "en",
          },
        ],
        subtitleSource: "provider" as const,
        timestamp: 0,
        providerResolveResult,
      },
    };
    const lines = buildDiagnosticsPanelLines({
      state,
      recentEvents: [],
    });

    const provider = lines.find((line) => line.label === "Provider");
    expect(provider?.detail).toContain("resolved");
    expect(provider?.detail).toMatch(/\d+ sources/);
    expect(provider?.detail).toContain("1 qualities");
    expect(provider?.detail).toContain("2 subtitle choices");
    expect(provider?.detail).not.toContain("private-stream");
    expect(provider?.detail).not.toContain("private-en.vtt");
    expect(provider?.tone).toBe("success");
  });

  test("buildDiagnosticsPanelLines includes concise selected source hints", () => {
    const providerResolveResult = {
      status: "resolved",
      providerId: "rivestream",
      selectedStreamId: "stream-1",
      streams: [
        {
          id: "stream-1",
          providerId: "rivestream",
          sourceId: "source-1",
          protocol: "hls",
          container: "m3u8",
          url: "https://cdn.example/private-stream.m3u8",
          confidence: 0.9,
          qualityLabel: "720p",
          artwork: { seekBarVttUrl: "https://cdn.example/timing.vtt" },
          metadata: { intro: { start: 90, end: 180 } },
          cachePolicy: {
            ttlClass: "stream-manifest",
            scope: "local",
            keyParts: [],
          },
        },
      ],
      sources: [
        {
          id: "source-1",
          providerId: "rivestream",
          kind: "mirror",
          status: "selected",
          host: "cdn.example",
          confidence: 0.9,
        },
      ],
      subtitles: [
        {
          id: "sub-en",
          providerId: "rivestream",
          sourceId: "source-1",
          url: "https://subs.example/private-en.vtt",
          language: "en",
          source: "provider",
          confidence: 0.9,
          cachePolicy: {
            ttlClass: "subtitle-list",
            scope: "local",
            keyParts: [],
          },
        },
      ],
      trace: {
        id: "trace-1",
        startedAt: "2026-05-19T00:00:00.000Z",
        cacheHit: false,
        title: { id: "demo", kind: "series", title: "Demo" },
        steps: [],
        failures: [],
      },
      failures: [],
    } satisfies ProviderResolveResult;
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      stream: {
        url: "https://cdn.example/private-stream.m3u8",
        headers: {},
        subtitle: "https://subs.example/private-en.vtt",
        timestamp: 0,
        providerResolveResult,
      },
    };

    const provider = buildDiagnosticsPanelLines({ state, recentEvents: [] }).find(
      (line) => line.label === "Provider",
    );

    expect(provider?.detail).toContain("selected source selected");
    expect(provider?.detail).toContain("host cdn.example");
    expect(provider?.detail).toContain("has timing");
    expect(provider?.detail).toContain("seek thumbnails");
    expect(provider?.detail).toContain("1 subtitle");
    expect(provider?.detail).not.toContain("private-stream");
    expect(provider?.detail).not.toContain("private-en.vtt");
  });

  test("buildDiagnosticsPanelLines puts plain-language health summary before technical sections", () => {
    const lines = buildDiagnosticsPanelLines({
      state: {
        ...createInitialState("vidking", "allanime", {
          anime: { audio: "original", subtitle: "en" },
          series: { audio: "original", subtitle: "none" },
          movie: { audio: "original", subtitle: "en" },
        }),
        playbackStatus: "stalled",
      },
      recentEvents: [
        {
          timestamp: 1,
          level: "warn",
          category: "cache",
          operation: "resolve.refetch.failed.cached-fallback",
          message: "Playback resolve fresh-source-failed-using-cache",
        },
        {
          timestamp: 2,
          level: "warn",
          category: "playback",
          operation: "playback.refresh.cooldown",
          message: "Source was refreshed recently. Continuing current stream.",
        },
      ],
      downloadSummary: { active: 0, completed: 2, failed: 1 },
      releaseSummary: { titleCount: 2, episodeCount: 4 },
      releaseDiagnostics: {
        trackedCount: 5,
        activeTitleCount: 2,
        activeEpisodeCount: 4,
        lastCheckedAt: "2026-06-13T10:00:00.000Z",
        nextDueAt: "2026-06-13T12:00:00.000Z",
        staleCount: 0,
        errorTitleCount: 0,
        dueNowCount: 1,
      },
      presenceSnapshot: {
        provider: "discord",
        status: "ready",
        privacy: "full",
        clientIdSource: "config",
        canConnect: true,
        detail: "connected",
      },
    });

    expect(lines[0]?.label).toMatch(/Diagnostics|issue/);
    expect(lines[0]?.tone).toMatch(/warning|error|success/);
    expect(lines.find((line) => line.label === "Session")?.detail).toContain("stalled");
    expect(lines.find((line) => line.label === "Downloads")?.tone).toBe("warning");
    expect(lines.find((line) => line.label === "Release sync")?.detail).toContain("4 new episodes");
    expect(lines.find((line) => line.label === "Release sync")?.detail).toContain(
      "5 tracked in cache",
    );
    expect(lines.findIndex((line) => line.label === "Session")).toBeLessThan(
      lines.findIndex((line) => line.label === "─── Export"),
    );
  });

  test("buildHistoryPanelLines sorts newest entries first", () => {
    const lines = buildHistoryPanelLines([
      [
        "older",
        {
          key: "k",
          titleId: "x",
          title: "Older Show",
          mediaKind: "series",
          season: 1,
          episode: 2,
          positionSeconds: 120,
          durationSeconds: 300,
          completed: false,
          providerId: "vidking",
          updatedAt: "2026-04-01T00:00:00.000Z",
          createdAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      [
        "newer",
        {
          key: "k",
          titleId: "x",
          title: "Newer Show",
          mediaKind: "series",
          season: 2,
          episode: 4,
          positionSeconds: 180,
          durationSeconds: 300,
          completed: false,
          providerId: "allanime",
          updatedAt: "2026-04-20T00:00:00.000Z",
          createdAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    ]);

    // Section headers appear before item rows; find the first row with a title
    const firstItemLine = lines.find((l) => l.label.includes("Show"));
    expect(firstItemLine?.label).toContain("Newer Show");
  });

  test("buildProviderPickerOptions marks current provider", () => {
    const options = buildProviderPickerOptions({
      currentProvider: "allanime",
      previewImageUrl: "https://img.example/poster.jpg",
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
    expect(options.map((option) => option.previewImageUrl)).toEqual([
      "https://img.example/poster.jpg",
      "https://img.example/poster.jpg",
    ]);
  });

  test("buildProviderPickerOptions surfaces effective health badges", () => {
    const options = buildProviderPickerOptions({
      currentProvider: "miruro",
      providers: [
        {
          id: "miruro",
          name: "Miruro",
          description: "Anime provider",
          recommended: false,
          isAnimeProvider: true,
        },
      ],
      getProviderHealth: () => ({
        providerId: "miruro",
        status: "down",
        checkedAt: new Date().toISOString(),
        consecutiveFailures: 7,
      }),
    });

    expect(options[0]?.detail).toContain("Health:");
    expect(options[0]?.detail).toContain("down");
    expect(options[0]?.detail).toContain("skipped in auto-fallback");
    expect(options[0]?.label).toContain("down");
    expect(options[0]?.label).toContain("skipped in auto-fallback");
  });

  test("buildDiagnosticsPanelLines includes provider memory section", () => {
    const state = createInitialState("miruro", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "en" },
      movie: { audio: "original", subtitle: "en" },
    });
    const lines = buildDiagnosticsPanelLines({
      state: { ...state, mode: "anime" },
      recentEvents: [],
      providers: [
        {
          id: "miruro",
          name: "Miruro",
          description: "Anime provider",
          recommended: false,
          isAnimeProvider: true,
        },
      ],
      getProviderHealth: () => ({
        providerId: "miruro",
        status: "down",
        checkedAt: new Date().toISOString(),
        consecutiveFailures: 5,
      }),
    });

    expect(lines.find((line) => line.label === "Provider memory")).toBeDefined();
    expect(lines.some((line) => line.detail?.includes("skipped in auto-fallback"))).toBe(true);
  });

  test("buildHistoryPickerOptions sorts newest entries first and keeps ids", () => {
    const options = buildHistoryPickerOptions([
      [
        "older",
        {
          key: "k",
          titleId: "x",
          title: "Older Show",
          mediaKind: "movie",
          season: 1,
          episode: 2,
          positionSeconds: 300,
          durationSeconds: 300,
          completed: true,
          providerId: "vidking",
          updatedAt: "2026-04-01T00:00:00.000Z",
          createdAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      [
        "newer",
        {
          key: "k",
          titleId: "x",
          title: "Newer Show",
          mediaKind: "movie",
          season: 2,
          episode: 4,
          positionSeconds: 300,
          durationSeconds: 300,
          completed: true,
          providerId: "allanime",
          updatedAt: "2026-04-20T00:00:00.000Z",
          createdAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    ]);

    expect(options[0]?.value).toBe("newer");
    expect(options[0]?.label).toContain("Newer Show");
    expect(options[1]?.value).toBe("older");
  });

  test("buildHistoryPickerOptions promotes released next episodes over completed history", () => {
    const options = buildHistoryPickerOptions(
      [
        [
          "anilist:123",
          {
            key: "k",
            titleId: "x",
            title: "Weekly Show",
            mediaKind: "series",
            season: 1,
            episode: 6,
            positionSeconds: 1440,
            durationSeconds: 1440,
            completed: true,
            providerId: "allanime",
            updatedAt: "2026-05-10T00:00:00.000Z",
            createdAt: "2026-05-10T00:00:00.000Z",
          },
        ],
      ],
      {
        nextReleases: new Map([
          [
            "anilist:123",
            {
              status: "released",
              releaseAt: "2026-05-17T10:00:00.000Z",
              season: 1,
              episode: 7,
            },
          ],
        ]),
        // Authoritative signal the classifier buckets off: a freshly-aired episode
        // (released after the 2026-05-10 watch) → new-episodes → keep-watching.
        releaseSignals: new Map([
          [
            "anilist:123",
            {
              status: "new-episodes",
              newEpisodeCount: 1,
              latestKnownReleaseAt: "2026-05-17T10:00:00.000Z",
            },
          ],
        ]),
      },
    );

    // The released next episode is keep-watching, so it sits under the hoisted
    // "Continue Watching" section header rather than at index 0.
    expect(options[0]?.value).toBe("section:history-continue-watching");
    const row = options.find((option) => option.value === "anilist:123");
    expect(row?.label).toContain("S01E07");
    expect(row?.detail).toContain("new since E6");
    expect(row?.detail).toContain("open next aired episode");
    expect(row?.badge).toBe("new");
    expect(row?.tone).toBe("success");
  });

  test("buildHistoryPickerOptions does NOT fabricate a 'new' badge for a finished title with no fresh release", () => {
    // Reported bug: a completed show you fell behind on (or with missing release data)
    // showed a "new" badge because the legacy reconcile fabricated new-episode. The row
    // must now agree with the authoritative bucket and stay out of new-episodes.
    const options = buildHistoryPickerOptions(
      [
        [
          "anilist:999",
          {
            key: "k2",
            titleId: "anilist:999",
            title: "Finished Show",
            mediaKind: "series",
            season: 1,
            episode: 12,
            positionSeconds: 1440,
            durationSeconds: 1440,
            completed: true,
            providerId: "allanime",
            updatedAt: "2026-06-10T00:00:00.000Z",
            createdAt: "2026-06-10T00:00:00.000Z",
          },
        ],
      ],
      {
        // A next episode is "released" (reconcile would fabricate new-episode), but the
        // authoritative signal says caught-up → bucket completed → no "new".
        nextReleases: new Map([
          [
            "anilist:999",
            { status: "released", releaseAt: "2019-01-01T00:00:00.000Z", season: 1, episode: 13 },
          ],
        ]),
        releaseSignals: new Map([
          ["anilist:999", { status: "caught-up", newEpisodeCount: 0, latestAiredEpisode: 12 }],
        ]),
      },
    );

    const row = options.find((option) => option.value === "anilist:999");
    expect(row?.badge).not.toBe("new");
  });

  test("buildHistoryPickerOptions presents cached offline-ready projections with the full new count", () => {
    const completed = {
      key: "k",
      titleId: "x",
      title: "Weekly Show",
      mediaKind: "series" as const,
      season: 1,
      episode: 5,
      positionSeconds: 1440,
      durationSeconds: 1440,
      completed: true,
      providerId: "allanime",
      updatedAt: "2026-05-10T00:00:00.000Z",
      createdAt: "2026-05-10T00:00:00.000Z",
    };
    const options = buildHistoryPickerOptions([["anilist:123", completed]], {
      projections: new Map([
        [
          "anilist:123",
          {
            kind: "offline-ready",
            titleId: "anilist:123",
            title: "Weekly Show",
            season: 1,
            episode: 6,
            sourceEntry: completed,
            badge: "3 new",
            freshness: "cached",
            primaryAction: { kind: "play-local", season: 1, episode: 6 },
          },
        ],
      ]),
    });

    expect(options[0]?.label).toBe("Continue Watching");
    expect(options[1]?.label).toContain("S01E06");
    expect(options[1]?.badge).toBe("3 new");
    expect(options[1]?.detail).toContain("download ready in /library");
  });

  test("buildHistoryPickerOptions names the explicit local action when an offline job is addressable", () => {
    const completed = {
      key: "k",
      titleId: "x",
      title: "Weekly Show",
      mediaKind: "series" as const,
      season: 1,
      episode: 5,
      positionSeconds: 1440,
      durationSeconds: 1440,
      completed: true,
      providerId: "allanime",
      updatedAt: "2026-05-10T00:00:00.000Z",
      createdAt: "2026-05-10T00:00:00.000Z",
    };
    const options = buildHistoryPickerOptions([["anilist:123", completed]], {
      projections: new Map([
        [
          "anilist:123",
          {
            kind: "offline-ready",
            titleId: "anilist:123",
            title: "Weekly Show",
            season: 1,
            episode: 6,
            sourceEntry: completed,
            badge: "1 new",
            freshness: "local",
            primaryAction: { kind: "play-local", season: 1, episode: 6, jobId: "job-6" },
          },
        ],
      ]),
    });

    expect(options[1]?.detail).toContain("enter plays downloaded episode");
  });

  describe("groupHistoryByRecency", () => {
    const DAY_MS = 86_400_000;

    function makeEntry(watchedAt: string): HistoryProgress {
      return {
        key: "k",
        titleId: "x",
        title: "Test Show",
        mediaKind: "series",
        season: 1,
        episode: 1,
        positionSeconds: 100,
        durationSeconds: 300,
        completed: false,
        providerId: "vidking",
        updatedAt: watchedAt,
        createdAt: watchedAt,
      };
    }

    test("places an entry watched 1 hour ago in Today", () => {
      const now = Date.now();
      const items: [string, ReturnType<typeof makeEntry>][] = [
        ["a", makeEntry(new Date(now - 3_600_000).toISOString())],
      ];
      const groups = groupHistoryByRecency(items);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.label).toBe("Today");
      expect(groups[0]?.items).toHaveLength(1);
    });

    test("places an entry watched 3 days ago in This Week", () => {
      const now = Date.now();
      const items: [string, ReturnType<typeof makeEntry>][] = [
        ["b", makeEntry(new Date(now - DAY_MS * 3).toISOString())],
      ];
      const groups = groupHistoryByRecency(items);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.label).toBe("This Week");
    });

    test("places an entry watched 30 days ago in Earlier", () => {
      const now = Date.now();
      const items: [string, ReturnType<typeof makeEntry>][] = [
        ["c", makeEntry(new Date(now - DAY_MS * 30).toISOString())],
      ];
      const groups = groupHistoryByRecency(items);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.label).toBe("Earlier");
    });

    test("returns all three groups when entries span all periods", () => {
      const now = Date.now();
      const items: [string, ReturnType<typeof makeEntry>][] = [
        ["today", makeEntry(new Date(now - 3_600_000).toISOString())],
        ["week", makeEntry(new Date(now - DAY_MS * 3).toISOString())],
        ["earlier", makeEntry(new Date(now - DAY_MS * 30).toISOString())],
      ];
      const groups = groupHistoryByRecency(items);
      expect(groups).toHaveLength(3);
      expect(groups.map((g) => g.label)).toEqual(["Today", "This Week", "Earlier"]);
    });

    test("returns empty array for empty input", () => {
      expect(groupHistoryByRecency([])).toHaveLength(0);
    });
  });

  test("buildHistoryPickerOptions adds section headers when entries span multiple periods", () => {
    const now = Date.now();
    const DAY_MS = 86_400_000;
    const options = buildHistoryPickerOptions([
      [
        "today",
        {
          key: "k",
          titleId: "x",
          title: "Today Show",
          mediaKind: "movie",
          season: 1,
          episode: 1,
          positionSeconds: 300,
          durationSeconds: 300,
          completed: true,
          providerId: "vidking",
          updatedAt: new Date(now - 3_600_000).toISOString(),
          createdAt: new Date(now - 3_600_000).toISOString(),
        },
      ],
      [
        "earlier",
        {
          key: "k",
          titleId: "x",
          title: "Earlier Show",
          mediaKind: "movie",
          season: 1,
          episode: 1,
          positionSeconds: 300,
          durationSeconds: 300,
          completed: true,
          providerId: "vidking",
          updatedAt: new Date(now - DAY_MS * 30).toISOString(),
          createdAt: new Date(now - DAY_MS * 30).toISOString(),
        },
      ],
    ]);

    const sectionValues = options
      .filter((o) => typeof o.value === "string" && o.value.startsWith("section:"))
      .map((o) => o.label);
    expect(sectionValues).toContain("Today");
    expect(sectionValues).toContain("Earlier");
  });

  test("buildHistoryPickerOptions surfaces Continue Watching before recency groups", () => {
    const now = Date.now();
    const DAY_MS = 86_400_000;
    const options = buildHistoryPickerOptions([
      [
        "completed-today",
        {
          key: "k",
          titleId: "x",
          title: "Finished Today",
          mediaKind: "series",
          season: 1,
          episode: 1,
          positionSeconds: 300,
          durationSeconds: 300,
          completed: true,
          providerId: "vidking",
          updatedAt: new Date(now - 3_600_000).toISOString(),
          createdAt: new Date(now - 3_600_000).toISOString(),
        },
      ],
      [
        "in-progress-week",
        {
          key: "k",
          titleId: "x",
          title: "Still Watching",
          mediaKind: "series",
          season: 1,
          episode: 4,
          positionSeconds: 120,
          durationSeconds: 300,
          completed: false,
          providerId: "vidking",
          updatedAt: new Date(now - DAY_MS * 3).toISOString(),
          createdAt: new Date(now - DAY_MS * 3).toISOString(),
        },
      ],
    ]);

    const sectionLabels = options
      .filter((o) => String(o.value).startsWith("section:"))
      .map((o) => o.label);
    expect(sectionLabels[0]).toBe("Continue Watching");
    expect(options.some((o) => o.value === "in-progress-week")).toBe(true);
    expect(options.find((o) => o.value === "in-progress-week")?.historyProgress?.percentage).toBe(
      40,
    );
    expect(options.find((o) => o.value === "in-progress-week")?.posterTitle).toBe("Still Watching");
  });

  test("buildHistoryPickerOptions omits section headers when all entries are in the same period", () => {
    const options = buildHistoryPickerOptions([
      [
        "older",
        {
          key: "k",
          titleId: "x",
          title: "Older Show",
          mediaKind: "movie",
          season: 1,
          episode: 2,
          positionSeconds: 300,
          durationSeconds: 300,
          completed: true,
          providerId: "vidking",
          updatedAt: "2026-04-01T00:00:00.000Z",
          createdAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      [
        "newer",
        {
          key: "k",
          titleId: "x",
          title: "Newer Show",
          mediaKind: "movie",
          season: 2,
          episode: 4,
          positionSeconds: 300,
          durationSeconds: 300,
          completed: true,
          providerId: "allanime",
          updatedAt: "2026-04-20T00:00:00.000Z",
          createdAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    ]);

    // Both entries are in "Earlier" → only 1 group → no section headers
    expect(options.every((o) => !String(o.value).startsWith("section:"))).toBe(true);
  });

  test("buildHistoryPanelLines emits recency section headers", () => {
    const now = Date.now();
    const DAY_MS = 86_400_000;
    const lines = buildHistoryPanelLines([
      [
        "today",
        {
          key: "k",
          titleId: "x",
          title: "Today Show",
          mediaKind: "series",
          season: 1,
          episode: 1,
          positionSeconds: 100,
          durationSeconds: 300,
          completed: false,
          providerId: "vidking",
          updatedAt: new Date(now - 3_600_000).toISOString(),
          createdAt: new Date(now - 3_600_000).toISOString(),
        },
      ],
      [
        "earlier",
        {
          key: "k",
          titleId: "x",
          title: "Earlier Show",
          mediaKind: "series",
          season: 1,
          episode: 1,
          positionSeconds: 100,
          durationSeconds: 300,
          completed: false,
          providerId: "vidking",
          updatedAt: new Date(now - DAY_MS * 30).toISOString(),
          createdAt: new Date(now - DAY_MS * 30).toISOString(),
        },
      ],
    ]);

    const sectionLabels = lines.filter((l) => l.tone === "info").map((l) => l.label);
    expect(sectionLabels).toContain("─── Today");
    expect(sectionLabels).toContain("─── Earlier");
  });

  test("buildDiagnosticsPanelLines exposes memory trend as a runtime-only diagnostic", () => {
    const lines = buildDiagnosticsPanelLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [],
      memorySamples: [
        {
          timestamp: 1000,
          snapshot: {
            appRssBytes: 256 * 1024 * 1024,
            appHeapUsedBytes: 80 * 1024 * 1024,
            appHeapTotalBytes: 128 * 1024 * 1024,
            playbackChildRssBytes: 0,
            playbackChildSwapBytes: 0,
            playbackChildCount: 0,
          },
        },
        {
          timestamp: 31_000,
          snapshot: {
            appRssBytes: 400 * 1024 * 1024,
            appHeapUsedBytes: 190 * 1024 * 1024,
            appHeapTotalBytes: 220 * 1024 * 1024,
            playbackChildRssBytes: 20 * 1024 * 1024,
            playbackChildSwapBytes: 0,
            playbackChildCount: 1,
          },
        },
      ],
    });

    const memoryTrend = lines.find((line) => line.label === "Memory trend");
    expect(memoryTrend?.detail?.toLowerCase()).toContain("growing");
    expect(memoryTrend?.tone).toBe("warning");
  });
});
