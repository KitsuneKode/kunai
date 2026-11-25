import type { Container } from "@/container";
import type { DiagnosticsSupportBundleInput } from "@/services/diagnostics/DiagnosticsService";
import { buildPlaybackSourceInventoryDiagnosticsSummary } from "@/services/playback/PlaybackSourceInventoryProjection";

import {
  buildDiagnosticsPanelInput,
  type DiagnosticsPanelLineInput,
} from "./diagnostics-panel-source";

export type SupportBundleInputFromContainer = DiagnosticsSupportBundleInput & {
  readonly sessionState: NonNullable<DiagnosticsSupportBundleInput["sessionState"]>;
};

/**
 * Container → diagnostics-service adapter.
 * Keeps `@/container` and app-shell panel types out of diagnostics services.
 */
export function buildSupportBundleInputFromContainer(
  container: Container,
  panelInput: DiagnosticsPanelLineInput = buildDiagnosticsPanelInput(container),
): SupportBundleInputFromContainer {
  const state = panelInput.state;
  const capabilitySnapshot = container.capabilitySnapshot;
  return {
    capabilities:
      // A boolean only — the acknowledgement timestamp and addon URLs stay
      // out of the bundle. Null stays null when neither source exists.
      capabilitySnapshot !== null || panelInput.stremioAddonsEnabled !== undefined
        ? {
            ...capabilitySnapshot,
            ...(panelInput.stremioAddonsEnabled !== undefined
              ? { experimentalStremioAddons: panelInput.stremioAddonsEnabled }
              : null),
          }
        : null,
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
    memorySamples: panelInput.memorySamples ?? null,
    getProviderHealth: panelInput.getProviderHealth,
    // Same event window the panel rendered — what you see is what you export.
    events: panelInput.recentEvents,
  };
}
