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
    operation: "release-reconciliation.refresh",
    category: "cache",
    audience: "developer",
    summary: "Catalog release progress was refreshed in a bounded background pass.",
  },
  {
    operation: "provider.title-health.suggestion",
    category: "provider",
    audience: "both",
    summary: "Repeated title-scoped failures justify offering a working fallback.",
    userAction: "Choose the suggested provider for this title, or keep the current provider.",
  },
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
    operation: "resolve.work.insight",
    category: "provider",
    audience: "developer",
    summary: "A redacted resolve work graph was exported for request economy diagnostics.",
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
    operation: "download.artifact.repairable",
    category: "download",
    audience: "both",
    summary: "The primary video is usable, but a subtitle or artwork sidecar needs repair.",
    userAction:
      "Open /downloads and retry the job to repair missing sidecars without redownloading video.",
  },
  {
    operation: "download.capacity.start",
    category: "download",
    audience: "both",
    summary:
      "A queued download paused before provider work because reserved disk space was reached.",
    userAction: "Free disk space or remove offline titles, then retry the paused download.",
  },
  {
    operation: "download.profile.confirmed",
    category: "download",
    audience: "developer",
    summary: "A manual download profile was confirmed before provider stream resolution.",
  },
  {
    operation: "offline-runway.evaluate",
    category: "download",
    audience: "both",
    summary: "Kunai evaluated a title-scoped offline continuation runway within capacity limits.",
    userAction: "Open /library to change this title's offline continuation preference.",
  },
  {
    operation: "offline-maintenance.process",
    category: "offline",
    audience: "both",
    summary: "Kunai processed a bounded offline maintenance pass.",
    userAction: "Open /downloads for repairs waiting on network access or Power Saver settings.",
  },
  {
    operation: "source-inventory.cache.hit",
    category: "cache",
    audience: "developer",
    summary: "Source inventory reused a compatible cached provider source projection.",
  },
  {
    operation: "source-inventory.cache.miss",
    category: "cache",
    audience: "developer",
    summary: "Source inventory needed a fresh provider source projection.",
  },
  {
    operation: "source-inventory.cache.set",
    category: "cache",
    audience: "developer",
    summary: "Source inventory stored a provider source projection with a bounded TTL.",
  },
  {
    operation: "source-inventory.cache.invalidated",
    category: "cache",
    audience: "developer",
    summary: "Source inventory invalidated a provider source projection.",
  },
  {
    operation: "post-playback.recommendations.seed",
    category: "playback",
    audience: "both",
    summary: "The post-playback screen used already-prefetched recommendations for first paint.",
  },
  {
    operation: "post-playback.recommendations.warm",
    category: "playback",
    audience: "developer",
    summary: "Post-playback recommendation data warmed in the background after the shell opened.",
  },
  {
    operation: "post-playback.autonext.prefetch-wait",
    category: "playback",
    audience: "developer",
    summary:
      "Auto-next waited for a near-EOF prefetch (up to the episode handoff budget) before falling back to normal resolve.",
  },
  {
    operation: "playback.prefetch-wait",
    category: "playback",
    audience: "developer",
    summary:
      "Episode navigation waited for an in-flight or urgent next-episode prefetch before foreground resolve.",
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
  {
    operation: "runtime.memory.sample",
    category: "runtime",
    audience: "both",
    summary: "Kunai captured app, player, total RSS, heap, and swap memory for diagnostics.",
    userAction: "Use repeated samples to compare app RSS, mpv RSS, heap, and swap over time.",
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
