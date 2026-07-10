import type { SessionState } from "@/domain/session/SessionState";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import type { ReleaseProgressDiagnosticsSummary } from "@/services/storage/storage-read-models";
import type { ProviderHealth, ProviderId } from "@kunai/types";

import type { PlaybackSourceInventoryDiagnosticsSummary } from "../playback/PlaybackSourceInventoryProjection";
import type { ResolveWorkLedgerSnapshot } from "../playback/ResolveWorkLedger";
import type { DiagnosticEvent } from "./diagnostic-event";
import { buildDiagnosticsInsight } from "./diagnostics-insight";
import type { RuntimeMemorySample } from "./runtime-memory";
import { buildDiagnosticsSupportBundle, type DiagnosticsSupportBundle } from "./support-bundle";

export type DiagnosticsBundleBuilderInput = {
  readonly appVersion: string;
  readonly debug: boolean;
  readonly capabilities?: Record<string, unknown> | null;
  readonly playbackSourceInventory?: PlaybackSourceInventoryDiagnosticsSummary | null;
  readonly resolveWorkLedgers?: readonly ResolveWorkLedgerSnapshot[] | null;
  readonly events: readonly DiagnosticEvent[];
  readonly sessionState?: SessionState | null;
  readonly downloadSummary?: { active: number; completed: number; failed?: number } | null;
  readonly releaseSummary?: { titleCount: number; episodeCount: number } | null;
  readonly releaseDiagnostics?: ReleaseProgressDiagnosticsSummary | null;
  readonly presenceSnapshot?: PresenceSnapshot | null;
  readonly memorySamples?: readonly RuntimeMemorySample[];
  readonly getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
  readonly now?: () => Date;
};

export function buildDiagnosticsBundle(
  input: DiagnosticsBundleBuilderInput,
): DiagnosticsSupportBundle {
  const insight = input.sessionState
    ? buildDiagnosticsInsight({
        state: input.sessionState,
        recentEvents: input.events,
        downloadSummary: input.downloadSummary,
        releaseSummary: input.releaseSummary,
        releaseDiagnostics: input.releaseDiagnostics,
        presenceSnapshot: input.presenceSnapshot,
        memorySamples: input.memorySamples,
        getProviderHealth: input.getProviderHealth,
      })
    : null;
  return buildDiagnosticsSupportBundle({ ...input, insight });
}
