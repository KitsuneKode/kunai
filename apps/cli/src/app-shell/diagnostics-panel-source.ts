import type { Container } from "@/container";
import { buildDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";
import {
  getRuntimeMemoryLine,
  getRuntimeMemorySamples,
  summarizeRuntimeMemoryTrend,
} from "@/services/diagnostics/runtime-memory";

import { buildDiagnosticsPanelModel, type DiagnosticsPanelModel } from "./diagnostics-panel.model";
import type { DiagnosticsPanelLineInput } from "./panel-data";

export function buildDiagnosticsPanelInput(
  container: Container,
  options: {
    youtubeProbe?: DiagnosticsPanelLineInput["youtubeProbe"];
    source?: string;
    expandedSpanIds?: ReadonlySet<string> | null;
  } = {},
): DiagnosticsPanelLineInput {
  const memorySamples = getRuntimeMemorySamples();
  const recentEvents = container.diagnosticsService.getRecent(container.debugTracePath ? 50 : 25);
  return {
    state: container.stateManager.getState(),
    recentEvents,
    developerMode: Boolean(container.debugTracePath),
    memorySamples,
    capabilitySnapshot: container.capabilitySnapshot,
    youtubeProbe: options.youtubeProbe,
    downloadSummary: {
      active: container.downloadService.listActive(200).length,
      completed: container.downloadService.listCompleted(200).length,
      failed: container.downloadService.listFailed(200).length,
    },
    releaseSummary: container.releaseProgressCache.summarizeActive(),
    releaseDiagnostics: container.releaseProgressCache.summarizeDiagnostics(),
    presenceSnapshot: container.presence.getSnapshot(),
    providers: container.providerRegistry.getAll().map((provider) => provider.metadata),
    getProviderHealth: (providerId) => container.providerHealth.get(providerId),
    expandedSpanIds: options.expandedSpanIds,
  };
}

/** Span-grouped view model for the diagnostics overlay (pure; no Ink). */
export function buildDiagnosticsSpanModel(
  recentEvents: DiagnosticsPanelLineInput["recentEvents"],
): DiagnosticsPanelModel {
  return buildDiagnosticsPanelModel({ recentEvents });
}

export function recordDiagnosticsPanelMemorySample(
  container: Container,
  source = "diagnostics-panel",
): void {
  const memoryLine = getRuntimeMemoryLine();
  const memoryTrend = summarizeRuntimeMemoryTrend(getRuntimeMemorySamples());
  container.diagnosticsService.record(
    buildDiagnosticEvent({
      category: "runtime",
      operation: "runtime.memory.sample",
      status: "succeeded",
      severity: memoryTrend.tone === "warning" ? "recoverable" : "healthy",
      recommendedAction: memoryTrend.tone === "warning" ? "export-diagnostics" : "none",
      spanFamily: "shell.overlay",
      message: "Runtime memory sample",
      context: { memory: memoryLine, trend: memoryTrend.detail, source },
    }),
  );
}
