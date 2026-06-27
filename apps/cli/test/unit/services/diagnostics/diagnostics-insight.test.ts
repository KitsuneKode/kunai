import { describe, expect, test } from "bun:test";

import { createInitialState } from "@/domain/session/SessionState";
import {
  buildDiagnosticsInsight,
  formatHealthRowDetail,
  formatRecommendedActionLabel,
  formatSessionVerdictLabel,
  type RecommendedAction,
} from "@/services/diagnostics/diagnostics-insight";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";

function baseState() {
  return createInitialState("vidking", "allanime", {
    anime: { audio: "original", subtitle: "en" },
    series: { audio: "original", subtitle: "en" },
    movie: { audio: "original", subtitle: "en" },
  });
}

describe("buildDiagnosticsInsight", () => {
  test("healthy session reports healthy verdict and none action", () => {
    const state = {
      ...baseState(),
      playbackStatus: "playing" as const,
      stream: { url: "https://cdn.example/stream.m3u8", headers: {}, timestamp: 0 },
    };
    const insight = buildDiagnosticsInsight({
      state,
      recentEvents: [
        {
          timestamp: 1,
          level: "info",
          category: "provider",
          operation: "provider.resolve.timeline",
          message: "Provider resolve succeeded",
          context: { status: "succeeded", providerId: "vidking" },
        },
      ],
    });

    expect(insight.sessionVerdict.severity).toBe("healthy");
    expect(formatSessionVerdictLabel(insight.sessionVerdict.severity)).toBe("Healthy");
    expect(insight.sessionVerdict.primaryAction).toBe("none");
    expect(insight.blockingIssues).toHaveLength(0);
    expect(insight.degradedSubsystems).toHaveLength(0);
    expect(insight.healthRows.find((row) => row.subsystem === "playback")?.severity).toBe(
      "healthy",
    );
  });

  test("provider timeout is explainable with fallback-provider action", () => {
    const insight = buildDiagnosticsInsight({
      state: baseState(),
      recentEvents: [
        {
          timestamp: 1,
          level: "error",
          category: "provider",
          operation: "provider.resolve.timeline",
          message: "Provider resolve exhausted",
          providerId: "vidking",
          context: {
            status: "failed",
            failureClass: "timeout",
            primaryFailure: "provider-timeout",
            attempts: 3,
          },
        },
        {
          timestamp: 2,
          level: "error",
          category: "provider",
          operation: "provider.resolve.attempt",
          message: "Provider attempt failed",
          providerId: "vidking",
          context: { phase: "failed", failureCode: "timeout", elapsedMs: 30_000 },
        },
      ],
    });

    expect(insight.sessionVerdict.severity).toMatch(/blocked|recoverable/);
    expect(insight.likelyCause.toLowerCase()).toContain("vidking");
    expect(insight.likelyCause.toLowerCase()).toMatch(/timeout|timed out/);
    expect(insight.recommendedActions).toContain("fallback-provider");
    const providerRow = insight.healthRows.find((row) => row.subsystem === "provider");
    expect(providerRow?.severity).toMatch(/blocked|recoverable/);
    expect(formatHealthRowDetail(providerRow!)).toMatch(/Needs attention|Failed/);
    expect(formatHealthRowDetail(providerRow!)).toMatch(/fallback provider/i);
  });

  test("network stall surfaces recover action", () => {
    const insight = buildDiagnosticsInsight({
      state: { ...baseState(), playbackStatus: "stalled" },
      recentEvents: [
        {
          timestamp: 1,
          level: "warn",
          category: "playback",
          operation: "playback",
          message: "MPV runtime event",
          context: {
            event: "stream-stalled",
            stallKind: "network-read-dead",
            secondsWithoutProgress: 45,
          },
        },
      ],
    });

    expect(insight.degradedSubsystems).toContain("network");
    const networkRow = insight.healthRows.find((row) => row.subsystem === "network");
    expect(networkRow?.severity).toMatch(/degraded|recoverable|blocked/);
    expect(insight.recommendedActions).toContain("recover");
    expect(insight.developerEvidence.networkEvents.length).toBeGreaterThan(0);
  });

  test("cache fallback is degraded not blocked", () => {
    const insight = buildDiagnosticsInsight({
      state: baseState(),
      recentEvents: [
        {
          timestamp: 1,
          level: "warn",
          category: "cache",
          operation: "resolve.refetch.failed.cached-fallback",
          message: "Fresh source unavailable; kept current playable stream",
        },
      ],
    });

    expect(insight.degradedSubsystems).toContain("cache");
    const cacheRow = insight.healthRows.find((row) => row.subsystem === "cache");
    expect(cacheRow?.severity).toBe("degraded");
    expect(formatHealthRowDetail(cacheRow!)).toMatch(/Needs attention/);
    expect(insight.recommendedActions).not.toContain("fallback-provider");
  });

  test("subtitle attach failure is recoverable", () => {
    const insight = buildDiagnosticsInsight({
      state: baseState(),
      recentEvents: [
        {
          timestamp: 1,
          level: "warn",
          category: "subtitle",
          operation: "subtitle.attach.outcome",
          message: "Subtitle attachment failed",
          context: { outcome: "failed", delivery: "wyzie-lookup" },
        },
      ],
    });

    const subtitleRow = insight.healthRows.find((row) => row.subsystem === "subtitles");
    expect(subtitleRow?.severity).toMatch(/degraded|recoverable/);
    expect(insight.currentPlaybackEvidence.subtitleOutcome).toMatch(/failed/i);
  });

  test("download failure recommends retry-download", () => {
    const insight = buildDiagnosticsInsight({
      state: baseState(),
      recentEvents: [],
      downloadSummary: { active: 0, completed: 1, failed: 2 },
    });

    const downloadRow = insight.healthRows.find((row) => row.subsystem === "downloads");
    expect(downloadRow?.severity).toMatch(/degraded|recoverable|blocked/);
    expect(downloadRow?.recommendedAction).toBe("retry-download");
    expect(formatRecommendedActionLabel("retry-download" as RecommendedAction)).toMatch(
      /retry|download/i,
    );
  });

  test("presence failure is degraded with open-settings or recover guidance", () => {
    const presenceSnapshot: PresenceSnapshot = {
      provider: "discord",
      status: "unavailable",
      privacy: "full",
      clientIdSource: "config",
      canConnect: false,
      detail: "Discord IPC unavailable",
    };
    const insight = buildDiagnosticsInsight({
      state: baseState(),
      recentEvents: [
        {
          timestamp: 1,
          level: "warn",
          category: "presence",
          operation: "presence.clear.failed",
          message: "Discord presence did not clear",
        },
      ],
      presenceSnapshot,
    });

    expect(insight.degradedSubsystems).toContain("discord");
    const discordRow = insight.healthRows.find((row) => row.subsystem === "discord");
    expect(discordRow?.severity).toMatch(/degraded|recoverable/);
  });

  test("export summary includes verdict and correlation", () => {
    const insight = buildDiagnosticsInsight({
      state: baseState(),
      recentEvents: [
        {
          timestamp: 1,
          level: "info",
          category: "provider",
          operation: "provider.resolve.timeline",
          message: "ok",
          sessionId: "sess-abc",
          playbackCycleId: "cycle-xyz",
          providerAttemptId: "attempt-123",
        },
      ],
    });

    expect(insight.exportSummary.verdict).toBeDefined();
    expect(insight.exportSummary.correlationSummary).toMatch(/cycle|provider|session/i);
    expect(insight.developerEvidence.correlation.playbackCycleId).toBe("cycle-xyz");
  });
});
