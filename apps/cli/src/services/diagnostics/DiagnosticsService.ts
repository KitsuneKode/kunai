import type { PlaybackSourceInventoryDiagnosticsSummary } from "../playback/PlaybackSourceInventoryProjection";
import type { ResolveWorkLedgerSnapshot } from "../playback/ResolveWorkLedger";
import type { DiagnosticEvent, DiagnosticEventInput } from "./diagnostic-event";
import type { DiagnosticsSupportBundle } from "./support-bundle";

export interface DiagnosticsService {
  record(event: DiagnosticEventInput): void;
  recordResolveWorkLedger(ledger: ResolveWorkLedgerSnapshot): void;
  getRecent(limit?: number): readonly DiagnosticEvent[];
  getSnapshot(): readonly DiagnosticEvent[];
  flush(): void;
  clear(): void;
  buildSupportBundle(input?: {
    readonly capabilities?: Record<string, unknown> | null;
    readonly playbackSourceInventory?: PlaybackSourceInventoryDiagnosticsSummary | null;
  }): DiagnosticsSupportBundle;
}
