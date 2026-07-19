import { describe, expect, test } from "bun:test";

import { buildSupportBundleInputFromContainer } from "@/app-shell/diagnostics-bundle-input";
import { buildDiagnosticsPanelLines } from "@/app-shell/panel-data";
import type { DiagnosticsPanelLineInput } from "@/app-shell/panel-data";
import type { Container } from "@/container";
import { createInitialState } from "@/domain/session/SessionState";
import type { Logger } from "@/infra/logger/Logger";
import { DiagnosticsServiceImpl } from "@/services/diagnostics/DiagnosticsServiceImpl";
import { DiagnosticsStoreImpl } from "@/services/diagnostics/DiagnosticsStoreImpl";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import type { ReleaseProgressDiagnosticsSummary } from "@/services/storage/storage-read-models";

function silentLogger(): Logger {
  return {
    child: () => silentLogger(),
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  };
}

const presenceUnavailable: PresenceSnapshot = {
  provider: "discord",
  status: "unavailable",
  privacy: "full",
  clientIdSource: "config",
  canConnect: false,
  detail: "Discord client unavailable",
};

const releaseDiagnostics: ReleaseProgressDiagnosticsSummary = {
  trackedCount: 3,
  activeTitleCount: 2,
  activeEpisodeCount: 4,
  lastCheckedAt: "2026-07-19T00:00:00.000Z",
  nextDueAt: null,
  staleCount: 1,
  errorTitleCount: 1,
  dueNowCount: 0,
};

describe("diagnostics bundle input parity", () => {
  test("panel and exported bundle share the same current-session evidence", () => {
    const diagnosticsService = new DiagnosticsServiceImpl({
      store: new DiagnosticsStoreImpl(),
      logger: silentLogger(),
      appVersion: "0.2.6",
      now: () => new Date("2026-07-19T12:00:00.000Z"),
    });
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "en" },
      movie: { audio: "original", subtitle: "en" },
    });
    const getProviderHealth = () => undefined;
    const panelInput: DiagnosticsPanelLineInput = {
      state,
      recentEvents: [],
      downloadSummary: { active: 0, completed: 1, failed: 1 },
      releaseSummary: { titleCount: 2, episodeCount: 4 },
      releaseDiagnostics,
      presenceSnapshot: presenceUnavailable,
      memorySamples: [],
      getProviderHealth,
    };
    const container = {
      diagnosticsService,
      stateManager: { getState: () => state },
      capabilitySnapshot: null,
    } as unknown as Container;

    const bundleInput = buildSupportBundleInputFromContainer(container, panelInput);
    const panelLines = buildDiagnosticsPanelLines(panelInput);
    const bundle = diagnosticsService.buildSupportBundle(bundleInput);

    expect(bundleInput.sessionState).toBe(panelInput.state);
    expect(bundleInput.downloadSummary).toBe(panelInput.downloadSummary);
    expect(bundleInput.releaseSummary).toBe(panelInput.releaseSummary);
    expect(bundleInput.releaseDiagnostics).toBe(panelInput.releaseDiagnostics);
    expect(bundleInput.presenceSnapshot).toBe(panelInput.presenceSnapshot);
    expect(bundleInput.memorySamples).toBe(panelInput.memorySamples);
    expect(bundleInput.getProviderHealth).toBe(panelInput.getProviderHealth);

    expect(panelLines.find((line) => line.label === "Downloads")?.tone).toBe("warning");
    expect(panelLines.find((line) => line.label === "Discord")?.tone).toBe("warning");
    expect(bundle.triage.affectedSubsystems).toEqual(
      expect.arrayContaining(["downloads", "discord", "release-sync"]),
    );
    expect(JSON.stringify(bundle)).not.toContain("getProviderHealth");
  });
});
