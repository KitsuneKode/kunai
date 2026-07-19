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
    operation: "search.bootstrap.completed",
    category: "search",
    audience: "both",
    summary: "Startup search completed and produced a result set for the initial query.",
    userAction: "Refine the query or switch mode if the result set is not useful.",
  },
  {
    operation: "search.query.completed",
    category: "search",
    audience: "both",
    summary: "An interactive search query completed with provider/catalog routing evidence.",
    userAction: "Use filters or provider mode if the listed results are unexpected.",
  },
  {
    operation: "search.phase.failed",
    category: "search",
    audience: "both",
    summary: "Search failed before a title could be selected.",
    userAction: "Retry search; if it repeats, export diagnostics with the failure context.",
  },
  {
    operation: "search.route.loaded",
    category: "search",
    audience: "both",
    summary: "A browse route such as trending, calendar, surprise, or discover loaded results.",
  },
  {
    operation: "search.discovery.loaded",
    category: "search",
    audience: "both",
    summary: "The interactive browse shell loaded a trending or discovery result set.",
  },
  {
    operation: "search.filter.applied",
    category: "search",
    audience: "both",
    summary: "The user applied a structured search filter chip.",
    userAction: "Submit the updated query or remove filters if the result set narrows too much.",
  },
  {
    operation: "search.filter.help",
    category: "search",
    audience: "both",
    summary: "The user opened search filter guidance without applying a chip.",
  },
  {
    operation: "search.offline-continuation.requested",
    category: "search",
    audience: "both",
    summary: "The user moved from an offline title context back into online search.",
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
    operation: "playback.stream.reused",
    category: "cache",
    audience: "developer",
    summary: "Playback reused an in-memory stream from a recent episode navigation.",
  },
  {
    operation: "provider.resolve.timeline",
    category: "provider",
    audience: "both",
    summary: "Provider attempts, retries, and fallback outcome for one resolve.",
    userAction: "Try fallback or report the provider timeline if all attempts fail.",
  },
  {
    operation: "provider.resolve.attempt",
    category: "provider",
    audience: "both",
    summary: "A physical provider resolve attempt changed state with measured time.",
  },
  {
    operation: "provider.resolve.fallback",
    category: "provider",
    audience: "both",
    summary: "Provider resolution moved to another provider after classified failure.",
  },
  {
    operation: "provider.selection.decision",
    category: "provider",
    audience: "both",
    summary: "The startup policy selected one ready provider stream.",
    userAction:
      "Switch startup preference or source manually if a different tradeoff is preferred.",
  },
  {
    operation: "resolve.work.insight",
    category: "provider",
    audience: "developer",
    summary: "A redacted resolve work graph was exported for request economy diagnostics.",
  },
  {
    operation: "subtitle.attach.outcome",
    category: "subtitle",
    audience: "both",
    summary: "Subtitle attachment completed or failed with a classified delivery outcome.",
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
    operation: "playback.startup.timeline",
    category: "playback",
    audience: "both",
    summary:
      "Playback startup recorded episode context, timing wait, resolve, player readiness, subtitle attachment, and first observed progress stages.",
    userAction:
      "Use the slowest measured stage to distinguish episode context, timing, provider, player, or subtitle delay.",
  },
  {
    operation: "playback.phase.failed",
    category: "playback",
    audience: "both",
    summary: "The playback phase returned a classified error to the session controller.",
    userAction: "Try a fallback provider when retryable, or export diagnostics for the error.",
  },
  {
    operation: "mpv.launch.started",
    category: "playback",
    audience: "both",
    summary: "Kunai handed the selected stream to mpv and began player startup.",
  },
  {
    operation: "mpv.playback.completed",
    category: "playback",
    audience: "both",
    summary: "mpv returned a playback result with watched time, exit reason, and recovery hints.",
    userAction: "Use the recovery hint if playback ended unexpectedly.",
  },
  {
    operation: "mpv.playback.failed",
    category: "playback",
    audience: "both",
    summary: "Kunai could not launch or complete mpv playback.",
    userAction: "Check that mpv is installed, then export diagnostics if the failure repeats.",
  },
  {
    operation: "mpv.hls-relay.started",
    category: "playback",
    audience: "developer",
    summary: "A curl HLS relay was started for a fingerprint-blocked CDN host.",
  },
  {
    operation: "mpv.hls-relay.stopped",
    category: "playback",
    audience: "developer",
    summary: "The curl HLS relay stopped after playback end, session release, idle, or error.",
  },
  {
    operation: "mpv.hls-relay.upstream-error",
    category: "playback",
    audience: "both",
    summary: "The HLS relay could not fetch an upstream playlist, segment, or key.",
    userAction: "Refresh the source or try another Miruro server if playback stalls.",
  },
  {
    operation: "mpv.hls-relay.unavailable",
    category: "playback",
    audience: "both",
    summary: "The HLS relay could not start (usually curl missing from PATH).",
    userAction: "Install curl, then retry Miruro playback.",
  },
  {
    operation: "mpv.hls-manifest.materialize-skipped",
    category: "playback",
    audience: "both",
    summary:
      "The HLS playlist could not be pre-fetched (CDN blocked or errored), so mpv was handed the direct URL instead.",
    userAction:
      "Usually harmless. If playback then fails, try another source or provider — the CDN is likely rejecting this client.",
  },
  {
    operation: "playback.startup-stall.aborted",
    category: "playback",
    audience: "both",
    summary: "Startup stall watchdog aborted mpv before first playback progress.",
    userAction:
      "Wait for failover, pick another source, or refresh if the CDN is slow but healthy.",
  },
  {
    operation: "subtitle.lookup.skipped",
    category: "subtitle",
    audience: "both",
    summary: "Late subtitle lookup was skipped because prerequisites or preferences were not met.",
  },
  {
    operation: "subtitle.lookup.started",
    category: "subtitle",
    audience: "developer",
    summary: "Late subtitle lookup began for the current title and episode.",
  },
  {
    operation: "subtitle.lookup.empty",
    category: "subtitle",
    audience: "both",
    summary: "Late subtitle lookup completed without selectable tracks.",
    userAction: "Keep watching without late subtitles or change subtitle preferences.",
  },
  {
    operation: "subtitle.lookup.no-selectable-url",
    category: "subtitle",
    audience: "developer",
    summary: "Late subtitle lookup found tracks but no safe URL could be attached.",
  },
  {
    operation: "subtitle.lookup.failed",
    category: "subtitle",
    audience: "both",
    summary: "Late subtitle lookup failed after playback had already started.",
    userAction: "Keep watching or export diagnostics if subtitle attachment keeps failing.",
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
    operation: "cache.streams.cleared",
    category: "cache",
    audience: "both",
    summary: "The user cleared stream cache while preserving provider failure memory.",
    userAction: "Resolve the episode again to repopulate stream cache.",
  },
  {
    operation: "cache.provider-memory.cleared",
    category: "cache",
    audience: "both",
    summary: "The user cleared stream cache and provider/title failure memory.",
    userAction: "Retry providers to rebuild fresh health evidence.",
  },
  {
    operation: "session.history.cleared",
    category: "session",
    audience: "both",
    summary: "The user cleared saved watch history and playback progress.",
  },
  {
    operation: "session.started",
    category: "session",
    audience: "developer",
    summary: "A Kunai interactive session started with initial mode and provider context.",
  },
  {
    operation: "session.shutdown.cleanup.failed",
    category: "session",
    audience: "developer",
    summary: "Shutdown cleanup failed while releasing player or presence resources.",
    userAction: "Restart Kunai if player or presence state looks stale.",
  },
  {
    operation: "session.fatal",
    category: "session",
    audience: "developer",
    summary: "The session controller caught an unrecoverable runtime error.",
    userAction: "Export diagnostics and include the fatal error when reporting the issue.",
  },
  {
    operation: "download.enqueue.blocked",
    category: "download",
    audience: "both",
    summary: "A download request was blocked before enqueue by feature or capability gates.",
    userAction: "Open setup or change download settings, then retry the download.",
  },
  {
    operation: "download.enqueue.succeeded",
    category: "download",
    audience: "both",
    summary: "A download job was accepted into the local queue with redacted job context.",
    userAction: "Open downloads to monitor progress or retry if the job later fails.",
  },
  {
    operation: "download.enqueue.failed",
    category: "download",
    audience: "both",
    summary: "A download request failed while creating the queue job.",
    userAction: "Retry the download; if it repeats, export diagnostics.",
  },
  {
    operation: "download.artifact.integrity.checked",
    category: "download",
    audience: "both",
    summary: "Kunai checked one or more offline artifacts for playable local files and sidecars.",
    userAction: "Retry or repair downloads that report missing or invalid artifacts.",
  },
  {
    operation: "download.playback.blocked",
    category: "download",
    audience: "both",
    summary: "Offline playback was blocked because the local artifact was not currently playable.",
    userAction: "Check integrity or retry the download before playing offline.",
  },
  {
    operation: "download.offline-more.completed",
    category: "download",
    audience: "both",
    summary: "The offline-library download-more action finished after asking for more episodes.",
    userAction: "Open downloads to inspect queued work if the action did not enqueue as expected.",
  },
  {
    operation: "export-diagnostics",
    category: "ui",
    audience: "both",
    summary: "The user exported a redacted diagnostics support bundle.",
    userAction: "Attach the exported bundle when reporting an issue.",
  },
  {
    operation: "diagnostics.report.exported",
    category: "ui",
    audience: "both",
    summary: "Kunai exported a redacted issue-report diagnostics bundle.",
    userAction: "Review the draft and submit the issue when ready.",
  },
  {
    operation: "runtime.memory.sample",
    category: "runtime",
    audience: "both",
    summary: "Kunai captured app, player, total RSS, heap, and swap memory for diagnostics.",
    userAction: "Use repeated samples to compare app RSS, mpv RSS, heap, and swap over time.",
  },
  {
    operation: "background.work.drain",
    category: "runtime",
    audience: "developer",
    summary: "A background work lane finished draining queued tasks.",
  },
  {
    operation: "background.work.shutdown",
    category: "runtime",
    audience: "developer",
    summary: "Background work scheduler began shutdown and drained pending lanes.",
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
