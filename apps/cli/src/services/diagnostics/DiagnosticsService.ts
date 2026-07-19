import type { SessionState } from "@/domain/session/SessionState";

import type { PlaybackSourceInventoryDiagnosticsSummary } from "../playback/PlaybackSourceInventoryProjection";
import type { ResolveWorkLedgerSnapshot } from "../playback/ResolveWorkLedger";
import type { DiagnosticEvent, DiagnosticEventInput } from "./diagnostic-event";
import type { DiagnosticsSupportBundle } from "./support-bundle";

export interface DiagnosticsService {
  record(event: DiagnosticEventInput): void;
  recordResolveWorkLedger(ledger: ResolveWorkLedgerSnapshot): void;
  getRecent(limit?: number): readonly DiagnosticEvent[];
  getSnapshot(): readonly DiagnosticEvent[];
  /** Monotonic revision for overlay memoization (invalidates on record/clear). */
  getRevision(): number;
  /** Subscribe to diagnostics buffer changes — fires after record/clear. */
  subscribe(listener: () => void): () => void;
  flush(): void;
  clear(): void;
  buildSupportBundle(input?: {
    readonly capabilities?: Record<string, unknown> | null;
    readonly playbackSourceInventory?: PlaybackSourceInventoryDiagnosticsSummary | null;
    readonly sessionState?: SessionState | null;
    readonly downloadSummary?: { active: number; completed: number; failed?: number } | null;
  }): DiagnosticsSupportBundle;
}
