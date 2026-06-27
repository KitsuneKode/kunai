import type { SessionState } from "@/domain/session/SessionState";

import type { PlaybackSourceInventoryDiagnosticsSummary } from "../playback/PlaybackSourceInventoryProjection";
import type { ResolveWorkLedgerSnapshot } from "../playback/ResolveWorkLedger";
import type { DiagnosticEvent } from "./diagnostic-event";
import { buildDiagnosticsInsight } from "./diagnostics-insight";
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
      })
    : null;
  return buildDiagnosticsSupportBundle({ ...input, insight });
}
