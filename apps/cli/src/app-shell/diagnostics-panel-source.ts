import type { Container } from "@/container";
import { buildDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";
import {
  getRuntimeMemoryLine,
  getRuntimeMemorySamples,
  summarizeRuntimeMemoryTrend,
} from "@/services/diagnostics/runtime-memory";

import type { DiagnosticsPanelLineInput } from "./panel-data";

/** Shared panel/export event window — keep waterfall/panel/export aligned. */
export const DIAGNOSTICS_PANEL_EVENT_LIMIT = 50;

export function buildDiagnosticsPanelInput(
  container: Container,
  options: {
    youtubeProbe?: DiagnosticsPanelLineInput["youtubeProbe"];
    source?: string;
  } = {},
): DiagnosticsPanelLineInput {
  const memorySamples = getRuntimeMemorySamples();
  // Developer timeline expands when a JSONL debug session is active (same signal
  // as `--debug` / debug-session bootstrap). Keep this tied to debugTracePath so
  // we do not invent a Container.debug field.
  const developerMode = Boolean(container.debugTracePath);
  return {
    state: container.stateManager.getState(),
    recentEvents: container.diagnosticsService.getRecent(DIAGNOSTICS_PANEL_EVENT_LIMIT),
    developerMode,
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
