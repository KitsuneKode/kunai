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
import { createInitialState } from "@/domain/session/SessionState";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import type { ProviderResolveResult } from "@kunai/types";

describe("panel-data", () => {
  test("buildHelpPanelLines returns stable guidance", () => {
    const lines = buildHelpPanelLines();
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.some((line) => line.label === "─── Panels & Commands")).toBe(true);
    expect(lines.some((line) => line.label === "Ctrl+W")).toBe(true);
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
    expect(provider?.detail).toContain("rivestream");
    expect(provider?.detail).toContain("2 streams");
    expect(provider?.tone).toBe("success");
  });

  test("buildDiagnosticsPanelLines includes smoke test recipes for manual checks", () => {
    const lines = buildDiagnosticsPanelLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [],
    });

    expect(lines.some((line) => line.label === "─── Smoke tests")).toBe(true);
    expect(lines.some((line) => line.detail === 'bun run dev -- -S "Dune"')).toBe(true);
    expect(lines.some((line) => line.detail === 'bun run dev -- -S "Attack on Titan" -a')).toBe(
      true,
    );
    expect(lines.some((line) => line.detail === 'bun run dev -- -S "Dune" --debug')).toBe(true);
    expect(lines.some((line) => line.detail === "bun run dev -- --discover")).toBe(true);
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

    expect(lines.find((line) => line.label === "Provider timeline")?.detail).toContain(
      "Recovered via Rivestream",
    );
    expect(lines.find((line) => line.label === "Provider timeline")?.detail).toContain(
      "vidking failed (timeout) -> rivestream succeeded",
    );
    expect(lines.find((line) => line.label === "Provider timeline")?.tone).toBe("success");
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

    expect(lines.find((line) => line.label === "Startup path")?.detail).toContain(
      "first-progress 2.1s",
    );
    expect(lines.find((line) => line.label === "Startup path")?.tone).toBe("success");
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

    const sourceInventory = lines.find((line) => line.label === "Source inventory");
    expect(sourceInventory?.detail).toContain("resolved");
    expect(sourceInventory?.detail).toContain("1 sources");
    expect(sourceInventory?.detail).toContain("1 qualities");
    expect(sourceInventory?.detail).toContain("2 subtitle choices");
    expect(sourceInventory?.detail).not.toContain("private-stream");
    expect(sourceInventory?.detail).not.toContain("private-en.vtt");
    expect(sourceInventory?.tone).toBe("success");
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

    const sourceInventory = buildDiagnosticsPanelLines({ state, recentEvents: [] }).find(
      (line) => line.label === "Source inventory",
    );

    expect(sourceInventory?.detail).toContain("selected source selected");
    expect(sourceInventory?.detail).toContain("host cdn.example");
    expect(sourceInventory?.detail).toContain("has timing");
    expect(sourceInventory?.detail).toContain("seek thumbnails");
    expect(sourceInventory?.detail).toContain("1 subtitle");
    expect(sourceInventory?.detail).not.toContain("private-stream");
    expect(sourceInventory?.detail).not.toContain("private-en.vtt");
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
      presenceSnapshot: {
        provider: "discord",
        status: "ready",
        privacy: "full",
        clientIdSource: "config",
        canConnect: true,
        detail: "connected",
      },
    });

    expect(lines[0]?.tone).toMatch(/warning|error|success/);
    expect(lines[1]).toEqual({ label: "─── Health", detail: "", tone: "info" });
    expect(lines.find((line) => line.label === "Playback")?.detail).toContain("Needs attention");
    expect(lines.find((line) => line.label === "Cache")?.detail).toContain(
      "kept current playable stream",
    );
    expect(lines.find((line) => line.label === "Downloads")?.tone).toBe("warning");
    expect(lines.findIndex((line) => line.label === "Playback")).toBeLessThan(
      lines.findIndex((line) => line.label === "─── Session"),
    );
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

    // Section headers appear before item rows; find the first row with a title
    const firstItemLine = lines.find((l) => l.label.includes("Show"));
    expect(firstItemLine?.label).toContain("Newer Show");
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
          timestamp: 300,
          duration: 300,
          completed: true,
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
          timestamp: 300,
          duration: 300,
          completed: true,
          provider: "allanime",
          watchedAt: "2026-04-20T00:00:00.000Z",
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
            title: "Weekly Show",
            type: "series",
            season: 1,
            episode: 6,
            timestamp: 1440,
            duration: 1440,
            completed: true,
            provider: "allanime",
            watchedAt: "2026-05-10T00:00:00.000Z",
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
      },
    );

    expect(options[0]?.label).toContain("S01E07");
    expect(options[0]?.detail).toContain("new since E6");
    expect(options[0]?.detail).toContain("ready when a source resolves");
    expect(options[0]?.badge).toBe("new");
    expect(options[0]?.tone).toBe("success");
  });

  test("buildHistoryPickerOptions presents cached offline-ready projections with the full new count", () => {
    const completed = {
      title: "Weekly Show",
      type: "series" as const,
      season: 1,
      episode: 5,
      timestamp: 1440,
      duration: 1440,
      completed: true,
      provider: "allanime",
      watchedAt: "2026-05-10T00:00:00.000Z",
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
      title: "Weekly Show",
      type: "series" as const,
      season: 1,
      episode: 5,
      timestamp: 1440,
      duration: 1440,
      completed: true,
      provider: "allanime",
      watchedAt: "2026-05-10T00:00:00.000Z",
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

    function makeEntry(watchedAt: string) {
      return {
        title: "Test Show",
        type: "series" as const,
        season: 1,
        episode: 1,
        timestamp: 100,
        duration: 300,
        completed: false,
        provider: "vidking",
        watchedAt,
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
          title: "Today Show",
          type: "series",
          season: 1,
          episode: 1,
          timestamp: 300,
          duration: 300,
          completed: true,
          provider: "vidking",
          watchedAt: new Date(now - 3_600_000).toISOString(),
        },
      ],
      [
        "earlier",
        {
          title: "Earlier Show",
          type: "series",
          season: 1,
          episode: 1,
          timestamp: 300,
          duration: 300,
          completed: true,
          provider: "vidking",
          watchedAt: new Date(now - DAY_MS * 30).toISOString(),
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
          title: "Finished Today",
          type: "series",
          season: 1,
          episode: 1,
          timestamp: 300,
          duration: 300,
          completed: true,
          provider: "vidking",
          watchedAt: new Date(now - 3_600_000).toISOString(),
        },
      ],
      [
        "in-progress-week",
        {
          title: "Still Watching",
          type: "series",
          season: 1,
          episode: 4,
          timestamp: 120,
          duration: 300,
          completed: false,
          provider: "vidking",
          watchedAt: new Date(now - DAY_MS * 3).toISOString(),
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
          title: "Older Show",
          type: "series",
          season: 1,
          episode: 2,
          timestamp: 300,
          duration: 300,
          completed: true,
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
          timestamp: 300,
          duration: 300,
          completed: true,
          provider: "allanime",
          watchedAt: "2026-04-20T00:00:00.000Z",
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
          title: "Today Show",
          type: "series",
          season: 1,
          episode: 1,
          timestamp: 100,
          duration: 300,
          completed: false,
          provider: "vidking",
          watchedAt: new Date(now - 3_600_000).toISOString(),
        },
      ],
      [
        "earlier",
        {
          title: "Earlier Show",
          type: "series",
          season: 1,
          episode: 1,
          timestamp: 100,
          duration: 300,
          completed: false,
          provider: "vidking",
          watchedAt: new Date(now - DAY_MS * 30).toISOString(),
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

    expect(lines.find((line) => line.label === "Memory trend")?.detail).toContain("growing");
    expect(lines.find((line) => line.label === "Memory trend")?.tone).toBe("warning");
    expect(lines.find((line) => line.label === "Memory")?.detail).toContain("Watch");
  });
});
