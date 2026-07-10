import type { Container } from "@/container";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import { buildPlaybackSourceInventoryDiagnosticsSummary } from "@/services/playback/PlaybackSourceInventoryProjection";

import { buildDiagnosticsPanelInput } from "./diagnostics-panel-source";

/**
 * Shared support-bundle input so export/report match the `/diagnostics` panel
 * insight (downloads, release sync, presence, memory, provider health).
 */
export function buildSupportBundleInputFromContainer(
  container: Container,
  panelInput: ReturnType<typeof buildDiagnosticsPanelInput> = buildDiagnosticsPanelInput(container),
): NonNullable<Parameters<DiagnosticsService["buildSupportBundle"]>[0]> {
  const state = panelInput.state;
  return {
    capabilities: container.capabilitySnapshot as unknown as Record<string, unknown> | null,
    playbackSourceInventory: state.stream?.providerResolveResult
      ? buildPlaybackSourceInventoryDiagnosticsSummary(state.stream.providerResolveResult, {
          selectedSubtitleUrl: state.stream.subtitle,
        })
      : null,
    sessionState: state,
    downloadSummary: panelInput.downloadSummary ?? null,
    releaseSummary: panelInput.releaseSummary ?? null,
    releaseDiagnostics: panelInput.releaseDiagnostics ?? null,
    presenceSnapshot: panelInput.presenceSnapshot ?? null,
    memorySamples: panelInput.memorySamples,
    getProviderHealth: panelInput.getProviderHealth,
  };
}
