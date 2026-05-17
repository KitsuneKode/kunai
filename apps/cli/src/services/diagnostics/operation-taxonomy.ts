import type { DiagnosticCategory } from "./diagnostic-event";

export type DiagnosticAudience = "user" | "developer" | "both";

export type DiagnosticOperationCatalogEntry = {
  readonly operation: string;
  readonly category: DiagnosticCategory;
  readonly audience: DiagnosticAudience;
  readonly summary: string;
  readonly userAction?: string;
};

export const DIAGNOSTIC_OPERATION_CATALOG: readonly DiagnosticOperationCatalogEntry[] = [
  {
    operation: "playback.recover.requested",
    category: "playback",
    audience: "both",
    summary: "The user requested recovery after playback failure evidence.",
    userAction: "Wait for recovery or try a fallback provider if prompted.",
  },
  {
    operation: "playback.refresh.requested",
    category: "playback",
    audience: "developer",
    summary: "Kunai requested a fresh source for the current playback intent.",
  },
  {
    operation: "playback.refresh.cooldown",
    category: "playback",
    audience: "both",
    summary: "A repeated voluntary refresh was rate-limited.",
    userAction: "Keep watching or use recover after actual failure evidence.",
  },
  {
    operation: "provider.resolve.timeline",
    category: "provider",
    audience: "both",
    summary: "Provider attempts, retries, and fallback outcome for one resolve.",
    userAction: "Try fallback or report the provider timeline if all attempts fail.",
  },
  {
    operation: "resolve.cache.hit",
    category: "cache",
    audience: "developer",
    summary: "Playback resolve reused a fresh cached stream.",
  },
  {
    operation: "resolve.cache.miss",
    category: "cache",
    audience: "developer",
    summary: "Playback resolve had no cache entry and needed provider work.",
  },
  {
    operation: "resolve.cache.stale",
    category: "cache",
    audience: "developer",
    summary: "Playback resolve found a stale cached stream and validated or refetched it.",
  },
  {
    operation: "resolve.refetch.failed.cached-fallback",
    category: "cache",
    audience: "both",
    summary: "Fresh lookup failed, so Kunai kept the current playable cached stream.",
    userAction: "Keep watching; use recover later if playback actually fails.",
  },
  {
    operation: "download.artifact.validated",
    category: "download",
    audience: "both",
    summary: "A completed download passed local artifact validation.",
    userAction: "Open /downloads or /library if the artifact later disappears.",
  },
  {
    operation: "presence.clear.failed",
    category: "presence",
    audience: "both",
    summary: "Discord presence did not clear cleanly during shutdown or disconnect.",
    userAction: "Quit Discord or restart Kunai if stale activity remains visible.",
  },
  {
    operation: "storage.maintenance.startup",
    category: "cache",
    audience: "developer",
    summary: "Startup storage maintenance pruned disposable cache data and optimized databases.",
  },
];

const OPERATIONS_BY_NAME = new Map(
  DIAGNOSTIC_OPERATION_CATALOG.map((entry) => [entry.operation, entry]),
);

export function getDiagnosticOperation(
  operation: string,
): DiagnosticOperationCatalogEntry | undefined {
  return OPERATIONS_BY_NAME.get(operation);
}

export function isKnownDiagnosticOperation(operation: string): boolean {
  return OPERATIONS_BY_NAME.has(operation);
}
