import { describe, expect, test } from "bun:test";

import { buildDiagnosticsPanelLinesFromInsight } from "@/app-shell/diagnostics-panel-lines";
import { createInitialState } from "@/domain/session/SessionState";
import { buildDiagnosticsInsight } from "@/services/diagnostics/diagnostics-insight";

function buildLines(
  input: Parameters<typeof buildDiagnosticsInsight>[0] & { developerMode?: boolean },
) {
  const { developerMode, ...insightInput } = input;
  const insight = buildDiagnosticsInsight(insightInput);
  return buildDiagnosticsPanelLinesFromInsight({ insight, developerMode });
}

describe("diagnostics-panel-lines", () => {
  test("renders sections in cockpit order", () => {
    const lines = buildLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "en" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [],
    });

    const sectionHeaders = lines.filter((line) => line.detail === "").map((line) => line.label);
    expect(sectionHeaders).toEqual([
      "─── Verdict",
      "─── Health",
      "─── Current Playback Evidence",
      "─── Developer Evidence",
      "─── Export And Report",
    ]);
  });

  test("verdict row uses plain-language label and next action", () => {
    const lines = buildLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "en" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [
        {
          timestamp: 1,
          level: "error",
          category: "provider",
          operation: "provider.resolve.timeline",
          message: "Provider resolve exhausted",
          providerId: "vidking",
          context: { status: "failed", failureClass: "timeout" },
        },
      ],
    });

    const verdict = lines.find((line) => line.label === "Verdict");
    expect(verdict?.detail).toMatch(/Needs attention|Broken/);
    expect(verdict?.detail).toMatch(/timed out|vidking/i);
    expect(verdict?.detail).toMatch(/fallback provider/i);
  });

  test("health rows use plain-language grammar", () => {
    const lines = buildLines({
      state: {
        ...createInitialState("vidking", "allanime", {
          anime: { audio: "original", subtitle: "en" },
          series: { audio: "original", subtitle: "en" },
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
          message: "kept cached stream",
        },
      ],
      downloadSummary: { active: 0, completed: 1, failed: 1 },
    });

    const provider = lines.find((line) => line.label === "Provider");
    expect(provider?.detail).toMatch(/OK|Needs attention|Failed|Unknown/);
    expect(provider?.detail).toContain("·");

    const cache = lines.find((line) => line.label === "Cache");
    expect(cache?.detail).toMatch(/Needs attention/);

    const downloads = lines.find((line) => line.label === "Downloads");
    expect(downloads?.detail).toMatch(/Needs attention|Failed/);
    expect(downloads?.detail).toMatch(/retry/i);
  });

  test("developer evidence includes correlation and timeline", () => {
    const lines = buildLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "en" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [
        {
          timestamp: 1,
          level: "info",
          category: "provider",
          operation: "provider.resolve.timeline",
          message: "ok",
          playbackCycleId: "cycle-abc",
          providerAttemptId: "attempt-xyz",
        },
        {
          timestamp: 2,
          level: "info",
          category: "provider",
          operation: "provider.resolve.attempt",
          message: "attempt",
          providerId: "vidking",
          context: { phase: "failed", failureCode: "timeout" },
        },
      ],
      developerMode: true,
    });

    const devStart = lines.findIndex((line) => line.label === "─── Developer Evidence");
    const exportStart = lines.findIndex((line) => line.label === "─── Export And Report");
    expect(devStart).toBeGreaterThan(-1);
    expect(exportStart).toBeGreaterThan(devStart);

    const devSection = lines.slice(devStart + 1, exportStart);
    expect(devSection.some((line) => line.label === "Correlation")).toBe(true);
    expect(devSection.some((line) => line.label === "Provider attempts")).toBe(true);
    expect(devSection.some((line) => line.label === "Recent spans")).toBe(true);
  });
});

describe("decision timeline", () => {
  test("surfaces decision-family events in their own section", () => {
    const lines = buildLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "en" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [
        {
          timestamp: 3,
          level: "info",
          category: "session",
          operation: "continuation.source",
          message: "Continue resolved to local artifact",
          context: {},
        },
        {
          timestamp: 2,
          level: "info",
          category: "provider",
          operation: "provider.selection.decision",
          message: "Picked vidking over miruro",
          providerId: "vidking",
          context: {},
        },
        {
          timestamp: 1,
          level: "info",
          category: "runtime",
          operation: "runtime.memory.sample",
          message: "Runtime memory sample",
          context: {},
        },
      ],
    });

    const sectionHeaders = lines.filter((line) => line.detail === "").map((line) => line.label);
    expect(sectionHeaders).toContain("─── Recent Decisions");

    const decisionsStart = lines.findIndex((line) => line.label === "─── Recent Decisions");
    const nextSection = lines.findIndex(
      (line, index) => index > decisionsStart && line.detail === "",
    );
    const decisionLines = lines.slice(decisionsStart + 1, nextSection);
    expect(decisionLines.some((line) => line.detail?.includes("local artifact"))).toBe(true);
    expect(decisionLines.some((line) => line.detail?.includes("Picked vidking"))).toBe(true);
    expect(decisionLines.some((line) => line.detail?.includes("memory sample"))).toBe(false);
  });

  test("omits the decisions section when no decision events exist", () => {
    const lines = buildLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "en" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [],
    });

    expect(lines.some((line) => line.label === "─── Recent Decisions")).toBe(false);
  });
});
