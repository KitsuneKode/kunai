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
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

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
