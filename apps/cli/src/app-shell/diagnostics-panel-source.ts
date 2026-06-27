import type { Container } from "@/container";
import { buildDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";
import {
  getRuntimeMemoryLine,
  getRuntimeMemorySamples,
  summarizeRuntimeMemoryTrend,
} from "@/services/diagnostics/runtime-memory";

import type { DiagnosticsPanelLineInput } from "./panel-data";

export function buildDiagnosticsPanelInput(
  container: Container,
  options: {
    youtubeProbe?: DiagnosticsPanelLineInput["youtubeProbe"];
    source?: string;
  } = {},
): DiagnosticsPanelLineInput {
  const memorySamples = getRuntimeMemorySamples();
  return {
    state: container.stateManager.getState(),
    recentEvents: container.diagnosticsService.getRecent(container.debugTracePath ? 50 : 25),
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
  };
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
