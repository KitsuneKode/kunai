import { describePlaybackSubtitleStatus } from "@/app/playback/subtitle-status";
import type { PlaybackProblemAction } from "@/domain/playback/playback-problem";
import type { SessionState } from "@/domain/session/SessionState";
import { buildPlaybackSourceInventoryDiagnosticsSummary } from "@/services/playback/PlaybackSourceInventoryProjection";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import type { ReleaseProgressDiagnosticsSummary } from "@/services/storage/storage-read-models";
import type { ProviderHealth, ProviderId } from "@kunai/types";

import type { DiagnosticEvent } from "./diagnostic-event";
import { buildRuntimeHealthSnapshot } from "./runtime-health";
import type { RuntimeMemorySample } from "./runtime-memory";

// ---------------------------------------------------------------------------
// Shared taxonomy
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = "healthy" | "degraded" | "recoverable" | "blocked" | "unknown";

export type RecommendedAction =
  | "none"
  | "wait"
  | "recover"
  | "fallback-provider"
  | "refresh-source"
  | "retry"
  | "retry-download"
  | "check-dependency"
  | "open-settings"
  | "export-diagnostics"
  | "report-issue";

export type DiagnosticsSubsystem =
  | "playback"
  | "provider"
  | "network"
  | "cache"
  | "subtitles"
  | "downloads"
  | "discord"
  | "release-sync"
  | "memory";

export type DiagnosticsHealthRow = {
  readonly subsystem: DiagnosticsSubsystem;
  readonly severity: DiagnosticSeverity;
  readonly label: string;
  readonly reason: string;
  readonly recommendedAction: RecommendedAction;
  readonly recommendedActionLabel: string;
};

export type DiagnosticsCorrelation = {
  readonly sessionId?: string;
  readonly playbackCycleId?: string;
  readonly providerAttemptId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
};

export type DiagnosticsCurrentPlaybackEvidence = {
  readonly title: string;
  readonly episode: string;
  readonly mode: string;
  readonly provider: string;
  readonly playbackStatus: string;
  readonly sourceState: string;
  readonly cacheState: string;
  readonly subtitleOutcome: string;
  readonly recoverStatus: string;
  readonly slowestStartupStage: string;
};

export type DiagnosticsDeveloperEvidence = {
  readonly correlation: DiagnosticsCorrelation;
  readonly providerTimeline: string;
  readonly providerAttempts: string;
  readonly sourceAttempts: string | null;
  readonly playbackStartup: string;
  readonly sourceInventoryWarnings: readonly string[];
  readonly networkEvents: readonly string[];
  readonly recentEvents: readonly DiagnosticEvent[];
};

export type DiagnosticsExportSummary = {
  readonly verdict: string;
  readonly likelyCause: string;
  readonly affectedSubsystems: readonly DiagnosticsSubsystem[];
  readonly recommendedActions: readonly RecommendedAction[];
  readonly correlationSummary: string;
};

export type DiagnosticsInsight = {
  readonly sessionVerdict: {
    readonly severity: DiagnosticSeverity;
    readonly label: string;
    readonly likelyCause: string;
    readonly primaryAction: RecommendedAction;
    readonly primaryActionLabel: string;
  };
  readonly likelyCause: string;
  readonly recommendedActions: readonly RecommendedAction[];
  readonly blockingIssues: readonly string[];
  readonly degradedSubsystems: readonly DiagnosticsSubsystem[];
  readonly healthRows: readonly DiagnosticsHealthRow[];
  readonly currentPlaybackEvidence: DiagnosticsCurrentPlaybackEvidence;
  readonly developerEvidence: DiagnosticsDeveloperEvidence;
  readonly exportSummary: DiagnosticsExportSummary;
};

export type BuildDiagnosticsInsightInput = {
  readonly state: SessionState;
  readonly recentEvents: readonly DiagnosticEvent[];
  readonly downloadSummary?: { active: number; completed: number; failed?: number } | null;
  readonly releaseSummary?: { titleCount: number; episodeCount: number } | null;
  readonly releaseDiagnostics?: ReleaseProgressDiagnosticsSummary | null;
  readonly presenceSnapshot?: PresenceSnapshot | null;
  readonly memorySamples?: readonly RuntimeMemorySample[];
  readonly getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
};

// ---------------------------------------------------------------------------
// Public formatters
// ---------------------------------------------------------------------------

export function formatSessionVerdictLabel(severity: DiagnosticSeverity): string {
  switch (severity) {
    case "healthy":
      return "Healthy";
    case "degraded":
    case "recoverable":
      return "Needs attention";
    case "blocked":
      return "Broken";
    default:
      return "Unknown";
  }
}

export function formatHealthStatusLabel(severity: DiagnosticSeverity): string {
  switch (severity) {
    case "healthy":
      return "OK";
    case "degraded":
    case "recoverable":
      return "Needs attention";
    case "blocked":
      return "Failed";
    default:
      return "Unknown";
  }
}

export function formatRecommendedActionLabel(action: RecommendedAction): string {
  switch (action) {
    case "none":
      return "No action needed";
    case "wait":
      return "Wait for background work";
    case "recover":
      return "Try recover";
    case "fallback-provider":
      return "Try fallback provider";
    case "refresh-source":
      return "Refresh source";
    case "retry":
      return "Retry";
    case "retry-download":
      return "Retry download";
    case "check-dependency":
      return "Check dependency";
    case "open-settings":
      return "Open settings";
    case "export-diagnostics":
      return "Export diagnostics";
    case "report-issue":
      return "Report issue";
    default:
      return "Unknown action";
  }
}

export function formatHealthRowDetail(row: DiagnosticsHealthRow): string {
  return `${row.label}  ·  ${row.reason}  ·  ${row.recommendedActionLabel}`;
}

// ---------------------------------------------------------------------------
// Insight builder
// ---------------------------------------------------------------------------

export function buildDiagnosticsInsight(input: BuildDiagnosticsInsightInput): DiagnosticsInsight {
  const runtimeHealth = buildRuntimeHealthSnapshot({
    recentEvents: input.recentEvents,
    currentProvider: input.state.provider,
    memorySamples: input.memorySamples,
    persistedProviderHealth: input.getProviderHealth?.(input.state.provider as ProviderId),
  });

  const healthRows = buildHealthRows(input, runtimeHealth);
  const degradedSubsystems = healthRows
    .filter(
      (row) =>
        row.severity === "degraded" || row.severity === "recoverable" || row.severity === "blocked",
    )
    .map((row) => row.subsystem);
  const blockingIssues = healthRows
    .filter((row) => row.severity === "blocked")
    .map((row) => `${row.subsystem}: ${row.reason}`);

  const likelyCause = resolveLikelyCause(input, healthRows);
  const recommendedActions = resolveRecommendedActions(input, healthRows);
  const sessionSeverity = resolveSessionSeverity(healthRows, input.state);
  const primaryAction = recommendedActions[0] ?? "none";

  const currentPlaybackEvidence = buildCurrentPlaybackEvidence(input);
  const developerEvidence = buildDeveloperEvidence(input);
  const exportSummary: DiagnosticsExportSummary = {
    verdict: formatSessionVerdictLabel(sessionSeverity),
    likelyCause,
    affectedSubsystems: degradedSubsystems,
    recommendedActions,
    correlationSummary: formatCorrelationSummary(developerEvidence.correlation),
  };

  return {
    sessionVerdict: {
      severity: sessionSeverity,
      label: formatSessionVerdictLabel(sessionSeverity),
      likelyCause,
      primaryAction,
      primaryActionLabel: formatRecommendedActionLabel(primaryAction),
    },
    likelyCause,
    recommendedActions,
    blockingIssues,
    degradedSubsystems,
    healthRows,
    currentPlaybackEvidence,
    developerEvidence,
    exportSummary,
  };
}

function buildHealthRows(
  input: BuildDiagnosticsInsightInput,
  runtimeHealth: ReturnType<typeof buildRuntimeHealthSnapshot>,
): DiagnosticsHealthRow[] {
  const {
    state,
    recentEvents,
    downloadSummary,
    releaseSummary,
    releaseDiagnostics,
    presenceSnapshot,
  } = input;

  const playbackIssue = recentEvents.find(
    (event) =>
      event.category === "playback" &&
      (event.level === "warn" ||
        event.level === "error" ||
        event.operation === "playback.refresh.cooldown"),
  );
  const cacheFallback = recentEvents.find(
    (event) => event.operation === "resolve.refetch.failed.cached-fallback",
  );
  const providerTimeline = recentEvents.find(
    (event) => event.operation === "provider.resolve.timeline",
  );
  const providerFailed = providerTimeline?.context?.status === "failed";
  const subtitleOutcome = recentEvents.find(
    (event) => event.operation === "subtitle.attach.outcome",
  );
  const failedDownloads = downloadSummary?.failed ?? 0;

  const playbackSeverity: DiagnosticSeverity =
    state.playbackProblem?.severity === "blocking"
      ? "blocked"
      : state.playbackProblem || playbackIssue || state.playbackStatus === "stalled"
        ? state.playbackProblem?.severity === "recoverable"
          ? "recoverable"
          : "degraded"
        : "healthy";

  const providerSeverity: DiagnosticSeverity = providerFailed
    ? isTimeoutFailure(providerTimeline)
      ? "recoverable"
      : "blocked"
    : state.stream?.providerResolveResult ||
        providerTimeline?.context?.status === "recovered" ||
        recentEvents.some((event) => event.category === "provider" && event.context?.trace)
      ? "healthy"
      : runtimeHealth.provider.tone === "error"
        ? "blocked"
        : runtimeHealth.provider.tone === "warning"
          ? "degraded"
          : state.stream?.url
            ? "healthy"
            : recentEvents.some((e) => e.operation === "provider.resolve.timeline")
              ? "healthy"
              : "unknown";

  const networkSeverity: DiagnosticSeverity =
    runtimeHealth.network.tone === "error"
      ? "blocked"
      : runtimeHealth.network.tone === "warning"
        ? "recoverable"
        : recentEvents.some((e) => e.context?.event === "stream-stalled")
          ? "recoverable"
          : "healthy";

  const cacheSeverity: DiagnosticSeverity = cacheFallback
    ? "degraded"
    : recentEvents.some((e) => e.operation === "resolve.cache.stale")
      ? "degraded"
      : "healthy";

  const subtitleSeverity: DiagnosticSeverity =
    subtitleOutcome?.context?.outcome === "failed"
      ? "recoverable"
      : subtitleOutcome?.context?.outcome === "skipped"
        ? "degraded"
        : !state.stream
          ? "unknown"
          : "healthy";

  const downloadSeverity: DiagnosticSeverity = !downloadSummary
    ? "unknown"
    : failedDownloads > 0
      ? "recoverable"
      : "healthy";

  const discordSeverity: DiagnosticSeverity =
    presenceSnapshot?.status === "error" || presenceSnapshot?.status === "unavailable"
      ? "degraded"
      : recentEvents.some((e) => e.operation === "presence.clear.failed")
        ? "degraded"
        : "healthy";

  const releaseSeverity: DiagnosticSeverity =
    releaseDiagnostics &&
    (releaseDiagnostics.errorTitleCount > 0 || releaseDiagnostics.staleCount > 0)
      ? "degraded"
      : "healthy";

  const memorySeverity: DiagnosticSeverity =
    runtimeHealth.memory.tone === "warning" || runtimeHealth.memoryTrend.tone === "warning"
      ? "degraded"
      : "healthy";

  return [
    buildHealthRow(
      "playback",
      playbackSeverity,
      resolvePlaybackReason(state, playbackIssue),
      resolvePlaybackAction(state, playbackIssue),
    ),
    buildHealthRow(
      "provider",
      providerSeverity,
      resolveProviderReason(input, providerTimeline, runtimeHealth.provider.detail),
      resolveProviderAction(providerSeverity, providerTimeline),
    ),
    buildHealthRow(
      "network",
      networkSeverity,
      runtimeHealth.network.detail,
      networkSeverity === "healthy" ? "none" : "recover",
    ),
    buildHealthRow(
      "cache",
      cacheSeverity,
      cacheFallback
        ? "Fresh source unavailable; kept current playable stream"
        : cacheSeverity === "degraded"
          ? "Stale stream was detected and refreshed"
          : "No cache issue in recent events",
      cacheSeverity === "degraded" ? "wait" : "none",
    ),
    buildHealthRow(
      "subtitles",
      subtitleSeverity,
      resolveSubtitleReason(state, subtitleOutcome),
      subtitleSeverity === "healthy" ? "none" : "retry",
    ),
    buildHealthRow(
      "downloads",
      downloadSeverity,
      resolveDownloadReason(downloadSummary),
      failedDownloads > 0 ? "retry-download" : "none",
    ),
    buildHealthRow(
      "discord",
      discordSeverity,
      resolveDiscordReason(presenceSnapshot),
      discordSeverity === "degraded" ? "open-settings" : "none",
    ),
    buildHealthRow(
      "release-sync",
      releaseSeverity,
      formatReleaseReason(
        releaseSummary,
        releaseDiagnostics,
        recentEvents.find((e) => e.operation === "release-reconciliation.refresh"),
      ),
      releaseSeverity === "degraded" ? "retry" : "none",
    ),
    buildHealthRow(
      "memory",
      memorySeverity,
      runtimeHealth.memory.detail ?? "Memory within normal range",
      memorySeverity === "degraded" ? "export-diagnostics" : "none",
    ),
  ];
}

function buildHealthRow(
  subsystem: DiagnosticsSubsystem,
  severity: DiagnosticSeverity,
  reason: string,
  recommendedAction: RecommendedAction,
): DiagnosticsHealthRow {
  return {
    subsystem,
    severity,
    label: formatHealthStatusLabel(severity),
    reason,
    recommendedAction,
    recommendedActionLabel: formatRecommendedActionLabel(recommendedAction),
  };
}

function resolveSessionSeverity(
  healthRows: readonly DiagnosticsHealthRow[],
  state: SessionState,
): DiagnosticSeverity {
  if (healthRows.some((row) => row.severity === "blocked")) return "blocked";
  if (state.playbackProblem?.severity === "blocking") return "blocked";
  if (healthRows.some((row) => row.severity === "recoverable")) return "recoverable";
  if (healthRows.some((row) => row.severity === "degraded")) return "degraded";

  const knownRows = healthRows.filter((row) => row.severity !== "unknown");
  if (knownRows.length === 0) return "unknown";
  if (knownRows.every((row) => row.severity === "healthy")) return "healthy";
  return "unknown";
}

function resolveLikelyCause(
  input: BuildDiagnosticsInsightInput,
  healthRows: readonly DiagnosticsHealthRow[],
): string {
  const { state, recentEvents } = input;
  if (state.playbackStatus === "stalled" && !state.playbackProblem) {
    return "Playback is stalled while waiting for progress or network data";
  }
  if (state.playbackProblem) {
    return state.playbackProblem.userMessage;
  }

  const providerTimeline = recentEvents.find((e) => e.operation === "provider.resolve.timeline");
  if (providerTimeline?.context?.status === "failed") {
    const providerId =
      (typeof providerTimeline.providerId === "string" ? providerTimeline.providerId : null) ??
      state.provider;
    const failureClass =
      typeof providerTimeline.context.failureClass === "string"
        ? providerTimeline.context.failureClass
        : "failure";
    if (failureClass === "timeout" || isTimeoutFailure(providerTimeline)) {
      return `${providerId} timed out while resolving the stream`;
    }
    const primaryFailure =
      typeof providerTimeline.context.primaryFailure === "string"
        ? providerTimeline.context.primaryFailure
        : failureClass;
    return `${providerId} failed: ${primaryFailure.replaceAll("-", " ")}`;
  }

  const stalled = recentEvents.find((e) => e.context?.event === "stream-stalled");
  if (stalled) {
    return "Playback stalled while waiting for network data";
  }

  const worst = [...healthRows]
    .filter((row) => row.severity !== "healthy" && row.severity !== "unknown")
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
  if (worst) {
    return `${worst.subsystem}: ${worst.reason}`;
  }

  return "No issues detected in recent diagnostics";
}

function resolveRecommendedActions(
  input: BuildDiagnosticsInsightInput,
  healthRows: readonly DiagnosticsHealthRow[],
): RecommendedAction[] {
  const actions = new Set<RecommendedAction>();
  for (const row of healthRows) {
    if (row.recommendedAction !== "none") {
      actions.add(row.recommendedAction);
    }
  }
  if (input.state.playbackProblem) {
    const mapped = mapPlaybackProblemAction(input.state.playbackProblem.recommendedAction);
    if (mapped) actions.add(mapped);
  }
  if (actions.size === 0) return ["none"];
  return [...actions];
}

function mapPlaybackProblemAction(action: PlaybackProblemAction): RecommendedAction | null {
  switch (action) {
    case "wait":
      return "wait";
    case "refresh":
      return "refresh-source";
    case "try-next-provider":
      return "fallback-provider";
    case "settings":
      return "open-settings";
    case "diagnostics":
      return "export-diagnostics";
    case "relaunch":
    case "pick-stream":
      return "recover";
    default:
      return null;
  }
}

function buildCurrentPlaybackEvidence(
  input: BuildDiagnosticsInsightInput,
): DiagnosticsCurrentPlaybackEvidence {
  const { state, recentEvents } = input;
  const playbackStartup = recentEvents.find((e) => e.operation === "playback.startup.timeline");
  const subtitleOutcome = recentEvents.find((e) => e.operation === "subtitle.attach.outcome");
  const cacheFallback = recentEvents.find(
    (e) => e.operation === "resolve.refetch.failed.cached-fallback",
  );
  const recoverEvent = recentEvents.find(
    (e) =>
      e.operation === "playback.recover.requested" || e.operation === "playback.refresh.requested",
  );

  const title = state.currentTitle?.name ?? "No title selected";
  const episode = state.currentEpisode
    ? `S${state.currentEpisode.season}E${state.currentEpisode.episode}`
    : state.currentTitle?.type === "movie"
      ? "Movie"
      : "No episode";

  return {
    title,
    episode,
    mode: state.mode,
    provider: state.provider,
    playbackStatus: state.playbackStatus,
    sourceState: state.stream?.url ? "stream resolved" : "no stream yet",
    cacheState: cacheFallback
      ? "kept cached stream after fresh lookup failed"
      : recentEvents.some((e) => e.operation === "resolve.cache.hit")
        ? "cache hit"
        : "no cache signal",
    subtitleOutcome: resolveSubtitleReason(input.state, subtitleOutcome),
    recoverStatus: recoverEvent
      ? `${recoverEvent.operation.replace("playback.", "").replace(".", " ")}`
      : "idle",
    slowestStartupStage: findSlowestStartupStage(playbackStartup),
  };
}

function buildDeveloperEvidence(input: BuildDiagnosticsInsightInput): DiagnosticsDeveloperEvidence {
  const { recentEvents } = input;
  const providerTimelineEvent = recentEvents.find(
    (e) => e.operation === "provider.resolve.timeline",
  );
  const playbackStartup = recentEvents.find((e) => e.operation === "playback.startup.timeline");
  const correlation = findActiveCorrelation(recentEvents);
  const networkEvents = recentEvents
    .filter((e) => e.message === "MPV runtime event")
    .slice(0, 8)
    .map((e) => {
      const eventType = typeof e.context?.event === "string" ? e.context.event : "unknown";
      return `${eventType}${e.context?.stallKind ? ` (${String(e.context.stallKind)})` : ""}`;
    });

  const sourceInventory = input.state.stream?.providerResolveResult
    ? buildPlaybackSourceInventoryDiagnosticsSummary(input.state.stream.providerResolveResult, {
        selectedSubtitleUrl: input.state.stream.subtitle,
      })
    : null;

  return {
    correlation,
    providerTimeline: formatProviderTimeline(providerTimelineEvent),
    providerAttempts: formatProviderAttempts(recentEvents),
    sourceAttempts: formatSourceAttemptsFromTimeline(providerTimelineEvent),
    playbackStartup: playbackStartup
      ? typeof playbackStartup.context?.summary === "string"
        ? playbackStartup.context.summary
        : playbackStartup.message
      : "no playback startup timeline yet",
    sourceInventoryWarnings: sourceInventory?.warnings.map((w) => w.message).filter(Boolean) ?? [],
    networkEvents,
    recentEvents: recentEvents.slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityRank(severity: DiagnosticSeverity): number {
  switch (severity) {
    case "blocked":
      return 4;
    case "recoverable":
      return 3;
    case "degraded":
      return 2;
    case "unknown":
      return 1;
    default:
      return 0;
  }
}

function isTimeoutFailure(event: DiagnosticEvent | undefined): boolean {
  if (!event?.context) return false;
  if (event.context.failureClass === "timeout") return true;
  if (event.context.primaryFailure === "provider-timeout") return true;
  return recentAttemptHasTimeout(event);
}

function recentAttemptHasTimeout(_event: DiagnosticEvent): boolean {
  return false;
}

function resolvePlaybackReason(
  state: SessionState,
  playbackIssue: DiagnosticEvent | undefined,
): string {
  if (state.playbackProblem) return state.playbackProblem.userMessage;
  if (state.playbackStatus === "stalled") return "Playback is stalled";
  if (playbackIssue) return playbackIssue.message;
  return "No playback issue in recent events";
}

function resolvePlaybackAction(
  state: SessionState,
  _playbackIssue: DiagnosticEvent | undefined,
): RecommendedAction {
  if (state.playbackProblem) {
    return mapPlaybackProblemAction(state.playbackProblem.recommendedAction) ?? "recover";
  }
  if (state.playbackStatus === "stalled") return "recover";
  return "none";
}

function resolveProviderReason(
  input: BuildDiagnosticsInsightInput,
  timeline: DiagnosticEvent | undefined,
  runtimeDetail: string,
): string {
  const { state, recentEvents } = input;
  const provider = state.provider;

  if (state.stream?.providerResolveResult) {
    const summary = buildPlaybackSourceInventoryDiagnosticsSummary(
      state.stream.providerResolveResult,
      { selectedSubtitleUrl: state.stream.subtitle },
    );
    const selected = summary.selected
      ? `${summary.selected.sourceId ?? "source?"}/${summary.selected.qualityLabel ?? "quality?"}`
      : "none";
    const hints = summary.sourceGroups.find((group) => group.state === "selected")?.hints;
    return [
      summary.status,
      `selected ${selected}`,
      hints?.length ? `selected source ${hints.join(" · ")}` : null,
      `${summary.sourceGroups.length} sources`,
      `${summary.qualityOptions.length} qualities`,
      `${summary.subtitleOptions.length} subtitle choices`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const traceEvent = recentEvents.find(
    (event) => event.category === "provider" && event.context?.trace,
  );
  if (traceEvent) {
    const context = traceEvent.context ?? {};
    const trace = context.trace as Record<string, unknown> | undefined;
    const selectedProvider =
      (typeof trace?.selectedProviderId === "string" ? trace.selectedProviderId : null) ?? provider;
    const streamCandidates =
      typeof context.streamCandidates === "number" ? context.streamCandidates : null;
    const subtitleCandidates =
      typeof context.subtitleCandidates === "number" ? context.subtitleCandidates : null;
    const parts = [
      selectedProvider,
      streamCandidates !== null ? `${streamCandidates} streams` : null,
      subtitleCandidates !== null ? `${subtitleCandidates} subtitles` : null,
      traceEvent.message,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
  }

  if (timeline?.context?.status === "failed") {
    const failureClass =
      typeof timeline.context.failureClass === "string" ? timeline.context.failureClass : "failed";
    if (failureClass === "timeout") return `${provider} timed out`;
    return runtimeDetail || `${provider} resolve failed`;
  }

  if (timeline?.providerId || timeline?.context?.status === "recovered") {
    const timelineProvider =
      (typeof timeline.providerId === "string" ? timeline.providerId : null) ?? provider;
    const attemptTimeline = formatProviderAttemptTimeline(timeline.context?.attemptTimeline);
    if (attemptTimeline) return `${timelineProvider} · ${attemptTimeline}`;
    return timeline.message || `${timelineProvider} · ${runtimeDetail}`;
  }

  return runtimeDetail || `${provider} · no resolve telemetry yet`;
}

function resolveDiscordReason(presenceSnapshot: PresenceSnapshot | null | undefined): string {
  if (!presenceSnapshot) return "Disabled or not used this session";
  return `${presenceSnapshot.status} · ${presenceSnapshot.detail}`;
}

function resolveProviderAction(
  severity: DiagnosticSeverity,
  timeline: DiagnosticEvent | undefined,
): RecommendedAction {
  if (severity === "healthy" || severity === "unknown") return "none";
  if (isTimeoutFailure(timeline) || severity === "recoverable") return "fallback-provider";
  return "fallback-provider";
}

function resolveDownloadReason(
  summary: { active: number; completed: number; failed?: number } | null | undefined,
): string {
  if (!summary) return "Queue status unavailable";
  const failed = summary.failed ?? 0;
  if (failed > 0) return `${failed} download job${failed === 1 ? "" : "s"} failed`;
  if (summary.active > 0) return `${summary.active} active job${summary.active === 1 ? "" : "s"}`;
  return "Queue idle";
}

function resolveSubtitleReason(state: SessionState, event: DiagnosticEvent | undefined): string {
  if (event?.context) {
    return formatSubtitleReason(event);
  }
  const subtitlePref =
    state.mode === "anime"
      ? state.animeLanguageProfile.subtitle
      : state.seriesLanguageProfile.subtitle;
  if (subtitlePref === "none") return "disabled by preference";
  if (!state.stream) return "not resolved yet";
  if (state.stream.subtitle) return "attached";
  const label = describePlaybackSubtitleStatus(state.stream, subtitlePref);
  if (state.stream.subtitleList?.length)
    return `${state.stream.subtitleList.length} tracks available`;
  return label || "not found";
}

function formatSubtitleReason(event: DiagnosticEvent | undefined): string {
  if (!event?.context) return "no subtitle attachment outcome yet";
  const outcome = typeof event.context.outcome === "string" ? event.context.outcome : "unknown";
  const delivery = typeof event.context.delivery === "string" ? event.context.delivery : "";
  return [outcome, delivery].filter(Boolean).join(" · ");
}

function formatReleaseReason(
  summary: { titleCount: number; episodeCount: number } | null | undefined,
  diagnostics: ReleaseProgressDiagnosticsSummary | null | undefined,
  recentReconciliation?: DiagnosticEvent,
): string {
  if (!summary && !diagnostics) return "Cache summary unavailable";
  const parts: string[] = [];
  if (summary && summary.episodeCount > 0) {
    parts.push(
      `${summary.episodeCount} new episode${summary.episodeCount === 1 ? "" : "s"} across ${summary.titleCount} tracked title${summary.titleCount === 1 ? "" : "s"}`,
    );
  } else {
    parts.push("no active new-episode projections");
  }
  if (diagnostics) {
    parts.push(`${diagnostics.trackedCount} tracked in cache`);
    if (diagnostics.dueNowCount > 0) parts.push(`${diagnostics.dueNowCount} due now`);
    if (diagnostics.staleCount > 0) parts.push(`${diagnostics.staleCount} stale`);
    if (diagnostics.errorTitleCount > 0) {
      parts.push(`${diagnostics.errorTitleCount} with errors`);
    }
  }
  const context = recentReconciliation?.context;
  if (context && typeof context.fetchedCount === "number") {
    parts.push(`${context.fetchedCount} refreshed`);
  }
  return parts.join(" · ");
}

function findActiveCorrelation(events: readonly DiagnosticEvent[]): DiagnosticsCorrelation {
  for (const event of events) {
    if (
      event.sessionId ||
      event.playbackCycleId ||
      event.providerAttemptId ||
      event.traceId ||
      event.spanId
    ) {
      return {
        sessionId: event.sessionId,
        playbackCycleId: event.playbackCycleId,
        providerAttemptId: event.providerAttemptId,
        traceId: event.traceId,
        spanId: event.spanId,
      };
    }
  }
  return {};
}

function formatCorrelationSummary(correlation: DiagnosticsCorrelation): string {
  const parts = [
    correlation.sessionId ? `session ${compactId(correlation.sessionId)}` : null,
    correlation.playbackCycleId ? `cycle ${compactId(correlation.playbackCycleId)}` : null,
    correlation.providerAttemptId ? `provider ${compactId(correlation.providerAttemptId)}` : null,
    correlation.traceId ? `trace ${compactId(correlation.traceId)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "no correlation IDs in recent events";
}

function compactId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatProviderTimeline(event: DiagnosticEvent | undefined): string {
  if (!event) return "no provider timeline yet";
  const attemptTimeline = formatProviderAttemptTimeline(event.context?.attemptTimeline);
  const attempts = event.context?.attempts;
  const failureClass = event.context?.failureClass;
  return [
    event.message,
    attemptTimeline,
    typeof attempts === "number" ? `${attempts} attempts` : null,
    typeof failureClass === "string" && failureClass !== "none" ? failureClass : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatProviderAttemptTimeline(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value
    .slice(0, 4)
    .map((attempt) => {
      if (!attempt || typeof attempt !== "object") return null;
      const record = attempt as Record<string, unknown>;
      const providerId = typeof record.providerId === "string" ? record.providerId : "provider";
      const status = typeof record.status === "string" ? record.status : "unknown";
      const failureClass =
        typeof record.failureClass === "string" && record.failureClass !== "none"
          ? record.failureClass
          : null;
      return `${providerId} ${status}${failureClass ? ` (${failureClass})` : ""}`;
    })
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(" -> ");
}

function formatSourceAttemptsFromTimeline(event: DiagnosticEvent | undefined): string | null {
  const attempts = Array.isArray(event?.context?.sourceAttempts)
    ? event.context.sourceAttempts
    : [];
  if (!attempts.length) return null;
  const formatted = attempts.slice(0, 5).map(formatProviderSourceAttempt).filter(Boolean);
  return formatted.length > 0 ? formatted.join(" · ") : null;
}

function formatProviderSourceAttempt(attempt: unknown): string | null {
  if (!attempt || typeof attempt !== "object") return null;
  const record = attempt as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : null;
  const serverId =
    typeof record.serverId === "string" || typeof record.serverId === "number"
      ? String(record.serverId)
      : null;
  const failureClass =
    typeof record.failureClass === "string" || typeof record.failureClass === "number"
      ? String(record.failureClass)
      : null;
  const label = serverId ?? "source";
  if (type === "source:failed") {
    return [label, "failed", failureClass].filter(Boolean).join(" ");
  }
  if (type === "source:success") return `${label} succeeded`;
  if (type === "source:start") return `${label} started`;
  return null;
}

function formatProviderAttempts(events: readonly DiagnosticEvent[]): string {
  const attempts = events
    .filter(
      (e) =>
        e.operation === "provider.resolve.attempt" || e.operation === "provider.resolve.fallback",
    )
    .slice(0, 5)
    .map((e) => {
      const provider = e.providerId ?? "provider";
      const phase = typeof e.context?.phase === "string" ? e.context.phase : "changed";
      const failure =
        phase === "failed" && typeof e.context?.failureCode === "string"
          ? ` (${e.context.failureCode})`
          : "";
      return `${provider} ${phase}${failure}`;
    });
  return attempts.length > 0 ? attempts.join(" · ") : "no physical provider attempts yet";
}

function findSlowestStartupStage(event: DiagnosticEvent | undefined): string {
  if (!event?.context) return "no playback startup timing yet";
  const timeline = event.context.timeline;
  if (!timeline || typeof timeline !== "object" || !("marks" in timeline)) {
    return "startup timing marks unavailable";
  }
  const marks = Array.isArray(timeline.marks) ? timeline.marks : [];
  let slowest: { stage: string; deltaMs: number } | null = null;
  for (const mark of marks) {
    if (!mark || typeof mark !== "object") continue;
    const record = mark as Record<string, unknown>;
    if (typeof record.stage !== "string" || typeof record.deltaMs !== "number") continue;
    if (!slowest || record.deltaMs > slowest.deltaMs) {
      slowest = { stage: record.stage, deltaMs: record.deltaMs };
    }
  }
  return slowest
    ? `${slowest.stage} ${formatMs(slowest.deltaMs)}`
    : "startup timing marks unavailable";
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
}
