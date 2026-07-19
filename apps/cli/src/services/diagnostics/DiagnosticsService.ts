import type { SessionState } from "@/domain/session/SessionState";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import type { ReleaseProgressDiagnosticsSummary } from "@/services/storage/storage-read-models";
import type { ProviderHealth, ProviderId } from "@kunai/types";

import type { PlaybackSourceInventoryDiagnosticsSummary } from "../playback/PlaybackSourceInventoryProjection";
import type { ResolveWorkLedgerSnapshot } from "../playback/ResolveWorkLedger";
import type { DiagnosticEvent, DiagnosticEventInput } from "./diagnostic-event";
import type { RuntimeMemorySample } from "./runtime-memory";
import type { DiagnosticsBundleEnvironment, DiagnosticsSupportBundle } from "./support-bundle";

export type DiagnosticsSupportBundleInput = {
  readonly capabilities?: Record<string, unknown> | null;
  readonly playbackSourceInventory?: PlaybackSourceInventoryDiagnosticsSummary | null;
  readonly sessionState?: SessionState | null;
  readonly downloadSummary?: { active: number; completed: number; failed?: number } | null;
  readonly releaseSummary?: { titleCount: number; episodeCount: number } | null;
  readonly releaseDiagnostics?: ReleaseProgressDiagnosticsSummary | null;
  readonly presenceSnapshot?: PresenceSnapshot | null;
  readonly memorySamples?: readonly RuntimeMemorySample[] | null;
  readonly getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
  /** When set (e.g. panel recentEvents), export uses this window instead of getSnapshot(). */
  readonly events?: readonly DiagnosticEvent[] | null;
  readonly environment?: DiagnosticsBundleEnvironment | null;
  readonly maxBytes?: number;
};

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
  buildSupportBundle(input?: DiagnosticsSupportBundleInput): DiagnosticsSupportBundle;
}
