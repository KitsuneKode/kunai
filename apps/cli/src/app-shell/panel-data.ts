import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
import {
  classifyHistoryBucket,
  type HistoryBucket,
  type HistoryReleaseSignal,
} from "@/domain/continuation/history-bucket";
import {
  reconcileContinueHistory,
  type ContinueHistoryRelease,
} from "@/domain/continuation/history-reconciliation";
import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import type { SessionState } from "@/domain/session/SessionState";
import type { ProviderMetadata } from "@/domain/types";
import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
import { historyContentType } from "@/services/continuation/history-progress";
import type { DiagnosticEvent } from "@/services/diagnostics/DiagnosticsStore";
import { buildRuntimeHealthSnapshot } from "@/services/diagnostics/runtime-health";
import type { RuntimeMemorySample } from "@/services/diagnostics/runtime-memory";
import { resolveDownloadFeatureState } from "@/services/download/DownloadFeature";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { formatTimestamp } from "@/services/persistence/HistoryStore";
import { buildPlaybackSourceInventoryDiagnosticsSummary } from "@/services/playback/PlaybackSourceInventoryProjection";
import {
  formatProviderHealthBadge,
  formatProviderHealthPickerLabelSuffix,
  isProviderFallbackEligible,
  resolveEffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import { describePresenceConfiguration } from "@/services/presence/PresenceServiceImpl";
import type { CapabilitySnapshot } from "@/ui";
import type { HistoryProgress, ReleaseProgressDiagnosticsSummary } from "@kunai/storage";
import type { ProviderHealth, ProviderId } from "@kunai/types";

import { helpSections } from "./keybindings";
import { describeHistoryReturnLoopDetail } from "./root-history-bridge";
import type { ShellPanelLine, ShellPickerOption } from "./types";

function summarizeHeaderKeys(headers: Record<string, string> | undefined): string {
  const keys = Object.keys(headers ?? {});
  return keys.length > 0 ? keys.join(", ") : "none";
}

function describeSubtitleState(state: SessionState): {
  label: string;
  tone: ShellPanelLine["tone"];
} {
  if (
    (state.mode === "anime"
      ? state.animeLanguageProfile.subtitle
      : state.seriesLanguageProfile.subtitle) === "none"
  ) {
    return { label: "disabled by preference", tone: "neutral" };
  }
  if (!state.stream) {
    return { label: "not resolved yet", tone: "neutral" };
  }
  const label = describePlaybackSubtitleStatus(
    state.stream,
    state.mode === "anime"
      ? state.animeLanguageProfile.subtitle
      : state.seriesLanguageProfile.subtitle,
  );
  if (state.stream.subtitle) {
    return { label: "attached", tone: "success" };
  }
  if (label.startsWith("hardsub")) {
    return { label, tone: "success" };
  }
  if (state.stream.subtitleList?.length) {
    return { label: `${state.stream.subtitleList.length} tracks available`, tone: "warning" };
  }
  return { label: "not found", tone: "warning" };
}

function findRecentMpvEvent(
  recentEvents: readonly DiagnosticEvent[],
  eventType: string,
): DiagnosticEvent | undefined {
  return recentEvents.find(
    (event) => event.message === "MPV runtime event" && event.context?.event === eventType,
  );
}

function formatMpvRuntimeDetail(event: DiagnosticEvent | undefined): string {
  if (!event?.context) return "not observed yet";
  const parts: string[] = [];
  if (typeof event.context.percent === "number") {
    parts.push(`${Math.round(event.context.percent)}%`);
  }
  if (typeof event.context.cacheAheadSeconds === "number") {
    parts.push(`${event.context.cacheAheadSeconds.toFixed(1)}s cache ahead`);
  }
  if (typeof event.context.cacheSpeed === "number") {
    parts.push(`${(event.context.cacheSpeed / 1024).toFixed(1)} KiB/s cache speed`);
  }
  if (typeof event.context.secondsWithoutProgress === "number") {
    parts.push(`${event.context.secondsWithoutProgress}s without progress`);
  }
  if (typeof event.context.stallKind === "string") {
    parts.push(`kind ${event.context.stallKind}`);
  }
  if (typeof event.context.secondsSeeking === "number") {
    parts.push(`${event.context.secondsSeeking}s seeking`);
  }
  if (event.context.failureClass && event.context.failureClass !== "none") {
    parts.push(`class ${String(event.context.failureClass)}`);
  }
  if (
    event.context.recovery &&
    typeof event.context.recovery === "object" &&
    "label" in event.context.recovery
  ) {
    parts.push(String(event.context.recovery.label));
  }
  return parts.length > 0 ? parts.join("  ·  ") : JSON.stringify(event.context);
}

type DiagnosticCorrelation = {
  readonly playbackCycleId?: string;
  readonly providerAttemptId?: string;
  readonly traceId?: string;
};

function findActiveCorrelation(events: readonly DiagnosticEvent[]): DiagnosticCorrelation | null {
  for (const event of events) {
    const correlation: DiagnosticCorrelation = {
      playbackCycleId: event.playbackCycleId,
      providerAttemptId: event.providerAttemptId,
      traceId: event.traceId,
    };
    if (correlation.playbackCycleId || correlation.providerAttemptId || correlation.traceId) {
      return correlation;
    }
  }
  return null;
}

function compactId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatCorrelation(correlation: DiagnosticCorrelation | null): string {
  if (!correlation) return "no active correlation yet";
  return [
    correlation.playbackCycleId ? `cycle ${compactId(correlation.playbackCycleId)}` : null,
    correlation.providerAttemptId ? `provider ${compactId(correlation.providerAttemptId)}` : null,
    correlation.traceId ? `trace ${compactId(correlation.traceId)}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
}

export function buildHelpPanelLines(): readonly ShellPanelLine[] {
  // Key chords are derived from the keybinding registry (single source of truth)
  // so the help overlay can never drift from the keys that are actually bound.
  // The slash-command list is curated here because those live in the command
  // registry, not the chord registry.
  const keyLines: ShellPanelLine[] = helpSections().flatMap((section) => [
    { label: `─── ${section.group}`, detail: "", tone: "info" as const },
    ...section.items.map((item) => ({ label: item.keys, detail: item.label })),
  ]);

  return [
    ...keyLines,

    // ── Panels & Commands (slash commands — see the command registry) ──
    { label: "─── Panels & commands", detail: "", tone: "info" },
    { label: "/history", detail: "Resume from recent progress" },
    { label: "/wl", detail: "View and manage your watchlist" },
    { label: "/playlist", detail: "View and manage your playback queue" },
    { label: "/stats", detail: "Watch statistics and streak" },
    { label: "/notifications", detail: "Actionable app notices and queue recovery" },
    { label: "/diagnostics", detail: "Session health, provider, and network status" },
    { label: "/downloads", detail: "Manage queued, running, and failed download jobs" },
    { label: "/library", detail: "Play completed local downloads" },
    { label: "/settings", detail: "Open settings editor" },
    { label: "/setup", detail: "Run dependency setup wizard" },
    { label: "/presence", detail: "Discord presence configuration" },
    { label: "/sync", detail: "AniList / TMDB sync configuration" },
    { label: "/export-diagnostics", detail: "Write redacted support bundle" },
    { label: "/report-issue", detail: "Open GitHub issue reporting" },
  ];
}

export function buildAboutPanelLines({
  config,
  state,
  capabilitySnapshot,
}: {
  config: KitsuneConfig;
  state: SessionState;
  capabilitySnapshot?: CapabilitySnapshot | null;
}): readonly ShellPanelLine[] {
  const capabilityLine =
    capabilitySnapshot && capabilitySnapshot.issues.length > 0
      ? `${capabilitySnapshot.issues.length} degraded capability ${capabilitySnapshot.issues.length === 1 ? "check" : "checks"}`
      : "all required capabilities available";
  const downloadFeature = resolveDownloadFeatureState({
    config,
    capabilities: capabilitySnapshot,
  });
  return [
    {
      label: "Version",
      detail: "v0.1.0",
    },
    {
      label: "Runtime",
      detail: `Bun ${Bun.version}  ·  Node ${process.versions.node}`,
    },
    {
      label: "Current mode",
      detail: `${state.mode}  ·  Provider ${state.provider}`,
    },
    {
      label: "Default startup mode",
      detail: `${config.defaultMode}  ·  Series ${config.provider}  ·  Anime ${config.animeProvider}`,
    },
    {
      label: "Presence",
      detail: describePresenceConfiguration(config),
    },
    {
      label: "Downloads",
      detail: downloadFeature.downloadPath
        ? `${downloadFeature.detail}  ·  ${downloadFeature.downloadPath}`
        : downloadFeature.detail,
      tone:
        downloadFeature.status === "ready"
          ? "success"
          : downloadFeature.status === "missing-yt-dlp"
            ? "warning"
            : "neutral",
    },
    {
      label: "Capabilities",
      detail: capabilityLine,
      tone: capabilitySnapshot?.issues.length ? "warning" : "success",
    },
    {
      label: "Privacy",
      detail: "Diagnostics stay local unless you explicitly export or share them.",
    },
  ];
}

export function buildDiagnosticsPanelLines({
  state,
  recentEvents,
  capabilitySnapshot,
  downloadSummary,
  releaseSummary,
  releaseDiagnostics,
  presenceSnapshot,
  memorySamples,
  providers,
  getProviderHealth,
}: {
  state: SessionState;
  recentEvents: readonly DiagnosticEvent[];
  capabilitySnapshot?: CapabilitySnapshot | null;
  downloadSummary?: { active: number; completed: number; failed?: number } | null;
  releaseSummary?: { titleCount: number; episodeCount: number } | null;
  releaseDiagnostics?: ReleaseProgressDiagnosticsSummary | null;
  presenceSnapshot?: PresenceSnapshot | null;
  memorySamples?: readonly RuntimeMemorySample[];
  providers?: readonly ProviderMetadata[];
  getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
}): readonly ShellPanelLine[] {
  const subtitleState = describeSubtitleState(state);
  const bufferingEvent = findRecentMpvEvent(recentEvents, "network-buffering");
  const streamStallEvent = findRecentMpvEvent(recentEvents, "stream-stalled");
  const seekStallEvent = findRecentMpvEvent(recentEvents, "seek-stalled");
  const ipcStallEvent = findRecentMpvEvent(recentEvents, "ipc-stalled");
  const _presenceEvent = recentEvents.find((event) => event.category === "presence");
  const providerTimelineEvent = recentEvents.find(
    (event) => event.operation === "provider.resolve.timeline",
  );
  const playbackStartupEvent = recentEvents.find(
    (event) => event.operation === "playback.startup.timeline",
  );
  const releaseReconciliationEvent = recentEvents.find(
    (event) => event.operation === "release-reconciliation.refresh",
  );
  const activeCorrelation = findActiveCorrelation(recentEvents);
  const subtitleOutcome = formatSubtitleOutcome(recentEvents);
  const sourceInventorySummary = state.stream?.providerResolveResult
    ? buildPlaybackSourceInventoryDiagnosticsSummary(state.stream.providerResolveResult, {
        selectedSubtitleUrl: state.stream.subtitle,
      })
    : null;
  const runtimeHealth = buildRuntimeHealthSnapshot({
    recentEvents,
    currentProvider: state.provider,
    memorySamples,
    persistedProviderHealth: getProviderHealth?.(state.provider as ProviderId),
  });
  const providerMemoryLines =
    providers && getProviderHealth
      ? buildProviderMemoryPanelLines({
          providers,
          getProviderHealth,
          mode: state.mode,
        })
      : [];
  const healthSummary = buildDiagnosticsHealthSummary({
    state,
    recentEvents,
    downloadSummary,
    releaseSummary,
    releaseDiagnostics,
    presenceSnapshot,
    runtimeProviderLine: runtimeHealth.provider,
    runtimeNetworkLine: runtimeHealth.network,
    runtimeMemoryLine: runtimeHealth.memory,
    runtimeMemoryTrendLine: runtimeHealth.memoryTrend,
    releaseReconciliationEvent,
  });

  const issueCount = healthSummary.filter(
    (line) => line.tone === "error" || line.tone === "warning",
  ).length;

  const sessionVerdictTone: ShellPanelLine["tone"] = state.playbackProblem
    ? "error"
    : state.playbackStatus === "error"
      ? "error"
      : state.playbackStatus === "playing"
        ? "success"
        : state.playbackStatus === "loading" || state.playbackStatus === "stalled"
          ? "warning"
          : "neutral";

  const sessionVerdictDetail = state.playbackProblem
    ? `${state.playbackProblem.stage}  ·  ${state.playbackProblem.cause}  ·  ${state.playbackProblem.recommendedAction}`
    : `${state.view}  ·  ${state.playbackStatus}  ·  ${state.searchResults.length} results cached`;

  const providerTraceEvent = recentEvents.find(
    (event) => event.category === "provider" && event.context?.trace,
  );
  const providerFailed = providerTimelineEvent?.context?.status === "failed";
  const traceStreamCandidates =
    typeof providerTraceEvent?.context?.streamCandidates === "number"
      ? providerTraceEvent.context.streamCandidates
      : 0;
  const providerVerdictTone: ShellPanelLine["tone"] = providerFailed
    ? "error"
    : sourceInventorySummary?.warnings.some((warning) => warning.tone === "danger")
      ? "error"
      : sourceInventorySummary?.warnings.length
        ? "warning"
        : state.stream?.url || traceStreamCandidates > 0
          ? "success"
          : "neutral";
  const providerVerdictDetail = state.stream?.url
    ? `${state.provider}  ·  stream resolved  ·  ${sourceInventorySummary ? formatSourceInventorySummary(sourceInventorySummary) : "inventory pending"}  ·  headers ${summarizeHeaderKeys(state.stream?.headers)}`
    : providerTraceEvent
      ? `${state.provider}  ·  ${providerTraceEvent.message}  ·  ${typeof providerTraceEvent.context?.streamCandidates === "number" ? `${providerTraceEvent.context.streamCandidates} streams` : "trace recorded"}`
      : `${state.provider}  ·  ${formatProviderTimelineEvent(providerTimelineEvent)}`;

  const networkIssue =
    Boolean(bufferingEvent) ||
    Boolean(streamStallEvent) ||
    Boolean(seekStallEvent) ||
    Boolean(ipcStallEvent) ||
    runtimeHealth.network.tone === "error" ||
    runtimeHealth.network.tone === "warning";
  const networkVerdictTone: ShellPanelLine["tone"] = networkIssue ? "warning" : "success";
  const networkVerdictDetail = networkIssue
    ? [
        bufferingEvent ? formatMpvRuntimeDetail(bufferingEvent) : null,
        streamStallEvent ? formatMpvRuntimeDetail(streamStallEvent) : null,
        seekStallEvent ? formatMpvRuntimeDetail(seekStallEvent) : null,
        ipcStallEvent ? formatMpvRuntimeDetail(ipcStallEvent) : null,
        runtimeHealth.network.detail,
      ]
        .filter((part): part is string => Boolean(part))
        .join("  ·  ")
    : `${runtimeHealth.network.label}: ${runtimeHealth.network.detail ?? "healthy"}`;

  const startupVerdictTone: ShellPanelLine["tone"] =
    playbackStartupEvent?.context?.stage === "first-progress"
      ? "success"
      : playbackStartupEvent
        ? "info"
        : "neutral";
  const startupVerdictDetail = playbackStartupEvent
    ? `${formatPlaybackStartupTimelineEvent(playbackStartupEvent)}  ·  slowest: ${findSlowestStartupStage(playbackStartupEvent)}`
    : "No startup timeline recorded this session";
  const sourceAttemptDetail = formatProviderSourceAttempts(providerTimelineEvent);

  return [
    {
      label:
        issueCount === 0 ? "Diagnostics" : `${issueCount} open issue${issueCount === 1 ? "" : "s"}`,
      detail:
        issueCount === 0
          ? "Session, provider, network, and startup paths look healthy"
          : "Review the sections below, then export if you need to share logs",
      tone: issueCount === 0 ? "success" : issueCount > 2 ? "error" : "warning",
    },
    {
      label: "Session",
      detail: sessionVerdictDetail,
      tone: sessionVerdictTone,
    },
    {
      label: "Mode",
      detail: `${state.mode}  ·  correlation ${formatCorrelation(activeCorrelation)}`,
      tone: "neutral",
    },
    {
      label: "Provider",
      detail: providerVerdictDetail,
      tone: providerVerdictTone,
    },
    ...providerMemoryLines,
    {
      label: "Resolve trace",
      detail: (() => {
        const attempts = formatProviderAttemptEvidence(recentEvents);
        if (attempts !== "no physical provider attempts yet") return attempts;
        return formatProviderTimelineEvent(providerTimelineEvent);
      })(),
      tone: providerVerdictTone,
    },
    ...(sourceAttemptDetail
      ? [
          {
            label: "Source attempts",
            detail: sourceAttemptDetail.detail,
            tone: sourceAttemptDetail.tone,
          } satisfies ShellPanelLine,
        ]
      : []),
    {
      label: "Network",
      detail: networkVerdictDetail,
      tone: networkVerdictTone,
    },
    runtimeHealth.memory,
    runtimeHealth.memoryTrend,
    {
      label: "Playback startup",
      detail: startupVerdictDetail,
      tone: startupVerdictTone,
    },
    {
      label: "Subtitles",
      detail: `${subtitleState.label}  ·  ${subtitleOutcome}`,
      tone: subtitleState.tone,
    },
    {
      label: "Downloads",
      detail: downloadSummary
        ? `${downloadSummary.active} active  ·  ${downloadSummary.completed} completed${
            (downloadSummary.failed ?? 0) > 0 ? `  ·  ${downloadSummary.failed} failed` : ""
          }`
        : "queue idle",
      tone: downloadSummary
        ? (downloadSummary.failed ?? 0) > 0
          ? "warning"
          : downloadSummary.active > 0
            ? "info"
            : "success"
        : "neutral",
    },
    {
      label: "Release sync",
      detail: formatReleaseSyncSummary(
        releaseSummary,
        releaseDiagnostics,
        releaseReconciliationEvent,
      ),
      tone: formatReleaseSyncTone(releaseSummary, releaseDiagnostics),
    },
    {
      label: "Presence",
      detail: presenceSnapshot
        ? `${presenceSnapshot.provider}  ·  ${presenceSnapshot.status}`
        : "off this session",
      tone:
        presenceSnapshot?.status === "unavailable" || presenceSnapshot?.status === "error"
          ? "warning"
          : "neutral",
    },
    {
      label: "Capabilities",
      detail:
        capabilitySnapshot?.issues.length && capabilitySnapshot.issues.length > 0
          ? capabilitySnapshot.issues.map((issue) => issue.id).join("  ·  ")
          : "Core playback tooling available",
      tone: capabilitySnapshot?.issues.length ? "warning" : "success",
    },
    { label: "─── Export", detail: "", tone: "info" },
    { label: "/export-diagnostics", detail: "Write a redacted support bundle to disk" },
    { label: "/report-issue", detail: "Open the GitHub issue template with context" },
  ];
}

function buildDiagnosticsHealthSummary({
  state,
  recentEvents,
  downloadSummary,
  releaseSummary,
  releaseDiagnostics,
  presenceSnapshot,
  runtimeProviderLine,
  runtimeNetworkLine,
  runtimeMemoryLine,
  runtimeMemoryTrendLine,
  releaseReconciliationEvent,
}: {
  state: SessionState;
  recentEvents: readonly DiagnosticEvent[];
  downloadSummary?: { active: number; completed: number; failed?: number } | null;
  releaseSummary?: { titleCount: number; episodeCount: number } | null;
  releaseDiagnostics?: ReleaseProgressDiagnosticsSummary | null;
  presenceSnapshot?: PresenceSnapshot | null;
  runtimeProviderLine: ShellPanelLine;
  runtimeNetworkLine: ShellPanelLine;
  runtimeMemoryLine: ShellPanelLine;
  runtimeMemoryTrendLine: ShellPanelLine;
  releaseReconciliationEvent?: DiagnosticEvent;
}): readonly ShellPanelLine[] {
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
  const failedDownloads = downloadSummary?.failed ?? 0;
  return [
    {
      label: "Playback",
      detail:
        state.playbackProblem || playbackIssue || state.playbackStatus === "stalled"
          ? `Needs attention  ·  ${state.playbackProblem?.userMessage ?? playbackIssue?.message ?? "Playback is stalled"}  ·  try recover or fallback`
          : "OK  ·  no playback issue in recent events",
      tone:
        state.playbackProblem?.severity === "blocking"
          ? "error"
          : state.playbackProblem || playbackIssue || state.playbackStatus === "stalled"
            ? "warning"
            : "success",
    },
    {
      label: "Provider",
      detail: `${runtimeProviderLine.tone === "error" ? "Failed" : runtimeProviderLine.tone === "warning" ? "Needs attention" : "OK"}  ·  ${runtimeProviderLine.detail ?? runtimeProviderLine.label}`,
      tone: runtimeProviderLine.tone,
    },
    {
      label: "Cache",
      detail: cacheFallback
        ? "Needs attention  ·  fresh source unavailable; kept current playable stream"
        : recentEvents.some((event) => event.operation === "resolve.cache.stale")
          ? "Needs attention  ·  stale stream was detected and refreshed"
          : recentEvents.some((event) => event.operation === "resolve.cache.hit")
            ? "OK  ·  stream cache hit"
            : "OK  ·  no cache issue in recent events",
      tone: cacheFallback ? "warning" : "success",
    },
    {
      label: "Discord",
      detail: presenceSnapshot
        ? `${presenceSnapshot.status === "error" || presenceSnapshot.status === "unavailable" ? "Needs attention" : "OK"}  ·  ${presenceSnapshot.detail}`
        : "OK  ·  disabled or not used this session",
      tone:
        presenceSnapshot?.status === "error" || presenceSnapshot?.status === "unavailable"
          ? "warning"
          : "success",
    },
    {
      label: "Downloads",
      detail: downloadSummary
        ? failedDownloads > 0
          ? `Needs attention  ·  ${failedDownloads} download job${failedDownloads === 1 ? "" : "s"}`
          : downloadSummary.active > 0
            ? `OK  ·  ${downloadSummary.active} active job${downloadSummary.active === 1 ? "" : "s"}`
            : "OK  ·  queue idle"
        : "Unknown  ·  queue status unavailable",
      tone: downloadSummary ? (failedDownloads > 0 ? "warning" : "success") : "neutral",
    },
    {
      label: "Release sync",
      detail: formatReleaseSyncSummary(
        releaseSummary,
        releaseDiagnostics,
        releaseReconciliationEvent,
      ),
      tone: formatReleaseSyncTone(releaseSummary, releaseDiagnostics),
    },
    {
      label: "Network",
      detail: `${runtimeNetworkLine.tone === "error" ? "Failed" : runtimeNetworkLine.tone === "warning" ? "Needs attention" : "OK"}  ·  ${runtimeNetworkLine.detail ?? runtimeNetworkLine.label}`,
      tone: runtimeNetworkLine.tone,
    },
    {
      label: "Memory",
      detail: `${runtimeMemoryLine.tone === "warning" || runtimeMemoryTrendLine.tone === "warning" ? "Watch" : "OK"}  ·  ${runtimeMemoryLine.detail ?? runtimeMemoryLine.label}`,
      tone:
        runtimeMemoryLine.tone === "warning" || runtimeMemoryTrendLine.tone === "warning"
          ? "warning"
          : runtimeMemoryLine.tone,
    },
  ];
}

function formatReleaseSyncSummary(
  summary: { titleCount: number; episodeCount: number } | null | undefined,
  diagnostics?: ReleaseProgressDiagnosticsSummary | null,
  recentReconciliation?: DiagnosticEvent,
): string {
  if (!summary && !diagnostics) return "cache summary unavailable";

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
    if (diagnostics.lastCheckedAt) {
      parts.push(`last checked ${formatDiagnosticsTimestamp(diagnostics.lastCheckedAt)}`);
    }
    if (diagnostics.nextDueAt) {
      parts.push(`next due ${formatDiagnosticsTimestamp(diagnostics.nextDueAt)}`);
    }
    if (diagnostics.dueNowCount > 0) {
      parts.push(`${diagnostics.dueNowCount} due now`);
    }
    if (diagnostics.staleCount > 0) {
      parts.push(`${diagnostics.staleCount} stale`);
    }
    if (diagnostics.errorTitleCount > 0) {
      parts.push(`${diagnostics.errorTitleCount} with errors`);
    }
  }

  const context = recentReconciliation?.context;
  if (context) {
    const skippedCount = context.skippedCount;
    const fetchedCount = context.fetchedCount;
    const trigger = context.trigger;
    if (typeof trigger === "string") parts.push(`last run ${trigger}`);
    if (typeof fetchedCount === "number") parts.push(`${fetchedCount} refreshed`);
    if (typeof skippedCount === "number" && skippedCount > 0) {
      parts.push(`${skippedCount} skipped by budget`);
    }
  }

  return parts.join("  ·  ");
}

function formatReleaseSyncTone(
  summary: { titleCount: number; episodeCount: number } | null | undefined,
  diagnostics?: ReleaseProgressDiagnosticsSummary | null,
): ShellPanelLine["tone"] {
  if (diagnostics && (diagnostics.errorTitleCount > 0 || diagnostics.staleCount > 0)) {
    return "warning";
  }
  if (summary && summary.episodeCount > 0) return "success";
  return "neutral";
}

function formatDiagnosticsTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const deltaMinutes = Math.round((Date.now() - ms) / 60_000);
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 48) return `${deltaHours}h ago`;
  return iso.slice(0, 10);
}

function formatProviderTimelineEvent(event: DiagnosticEvent | undefined): string {
  if (!event) return "no provider timeline yet";
  const attempts = event.context?.attempts;
  const attemptTimeline = formatProviderAttemptTimeline(event.context?.attemptTimeline);
  const failureClass = event.context?.failureClass;
  const primaryFailure = event.context?.primaryFailure;
  return [
    event.message,
    attemptTimeline,
    typeof attempts === "number" ? `${attempts} attempts` : null,
    typeof failureClass === "string" && failureClass !== "none" ? failureClass : null,
    typeof primaryFailure === "string" ? primaryFailure : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
}

function formatPlaybackStartupTimelineEvent(event: DiagnosticEvent | undefined): string {
  if (!event) return "no playback startup timeline yet";
  return typeof event.context?.summary === "string" ? event.context.summary : event.message;
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
    if (!Number.isFinite(record.deltaMs)) continue;
    if (!slowest || record.deltaMs > slowest.deltaMs) {
      slowest = { stage: record.stage, deltaMs: record.deltaMs };
    }
  }
  return slowest
    ? `${slowest.stage} ${formatMs(slowest.deltaMs)}`
    : "startup timing marks unavailable";
}

function formatProviderAttemptEvidence(events: readonly DiagnosticEvent[]): string {
  const attempts = events
    .filter(
      (event) =>
        event.operation === "provider.resolve.attempt" ||
        event.operation === "provider.resolve.fallback",
    )
    .slice(0, 5)
    .map((event) => {
      const context = event.context ?? {};
      if (event.operation === "provider.resolve.fallback") {
        const from =
          typeof context.fromProviderId === "string" ? context.fromProviderId : "provider";
        const to =
          typeof context.toProviderId === "string" ? context.toProviderId : event.providerId;
        return `${from} -> ${to} fallback`;
      }
      const provider = event.providerId ?? "provider";
      const phase = typeof context.phase === "string" ? context.phase : "changed";
      const elapsed =
        typeof context.elapsedMs === "number" ? ` in ${formatMs(context.elapsedMs)}` : "";
      const failure =
        phase === "failed" && typeof context.failureCode === "string"
          ? ` (${context.failureCode})`
          : "";
      return `${provider} ${phase}${elapsed}${failure}`;
    });
  return attempts.length > 0 ? attempts.join("  ·  ") : "no physical provider attempts yet";
}

function formatProviderSourceAttempts(
  event: DiagnosticEvent | undefined,
): { detail: string; tone: ShellPanelLine["tone"] } | null {
  const attempts = Array.isArray(event?.context?.sourceAttempts)
    ? event.context.sourceAttempts
    : [];
  if (!attempts.length) return null;
  const formatted = attempts.slice(0, 5).map(formatProviderSourceAttempt).filter(Boolean);
  if (!formatted.length) return null;
  const failed = attempts.some(
    (attempt) =>
      attempt &&
      typeof attempt === "object" &&
      "type" in attempt &&
      attempt.type === "source:failed",
  );
  return {
    detail: formatted.join("  ·  "),
    tone: failed ? "warning" : "info",
  };
}

function formatProviderSourceAttempt(attempt: unknown): string | null {
  if (!attempt || typeof attempt !== "object") return null;
  const record = attempt as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : null;
  const sourceId = typeof record.sourceId === "string" ? record.sourceId : null;
  const serverId =
    typeof record.serverId === "string" || typeof record.serverId === "number"
      ? String(record.serverId)
      : null;
  const failureClass =
    typeof record.failureClass === "string" || typeof record.failureClass === "number"
      ? String(record.failureClass)
      : null;
  const attemptNumber = typeof record.attempt === "number" ? `#${record.attempt}` : null;
  const label = serverId ?? sourceId?.split(":").at(-1) ?? "source";
  if (type === "source:failed") {
    return [label, "failed", failureClass, attemptNumber].filter(Boolean).join(" ");
  }
  if (type === "source:success") {
    return [label, "succeeded", attemptNumber].filter(Boolean).join(" ");
  }
  if (type === "source:start") {
    return [label, "started", attemptNumber].filter(Boolean).join(" ");
  }
  return null;
}

function formatSubtitleOutcome(events: readonly DiagnosticEvent[]): string {
  const event = events.find((candidate) => candidate.operation === "subtitle.attach.outcome");
  if (!event?.context) return "no subtitle attachment outcome yet";
  const outcome = typeof event.context.outcome === "string" ? event.context.outcome : "unknown";
  const delivery = typeof event.context.delivery === "string" ? event.context.delivery : "unknown";
  const attachedCount =
    typeof event.context.attachedCount === "number"
      ? `${event.context.attachedCount} attached`
      : null;
  return [outcome, delivery, attachedCount].filter(Boolean).join("  ·  ");
}

function formatSourceInventorySummary(
  summary: ReturnType<typeof buildPlaybackSourceInventoryDiagnosticsSummary>,
): string {
  const selected = summary.selected
    ? `${summary.selected.sourceId ?? "source?"}/${summary.selected.qualityLabel ?? "quality?"}`
    : "none";
  const selectedSourceHints = summary.sourceGroups.find(
    (group) => group.state === "selected",
  )?.hints;
  return [
    summary.status,
    `selected ${selected}`,
    selectedSourceHints?.length ? `selected source ${selectedSourceHints.join("  ·  ")}` : null,
    `${summary.sourceGroups.length} sources`,
    `${summary.qualityOptions.length} qualities`,
    `${summary.languageOptions.length} languages`,
    `${summary.subtitleOptions.length} subtitle choices`,
    summary.warnings.length ? `${summary.warnings.length} warnings` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
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

export function renderHistoryProgressBar(percentage: number): string {
  const totalBlocks = 10;
  const filledBlocks = Math.max(
    0,
    Math.min(totalBlocks, Math.round((percentage / 100) * totalBlocks)),
  );
  const emptyBlocks = totalBlocks - filledBlocks;
  return `[${"█".repeat(filledBlocks)}${"░".repeat(emptyBlocks)}]`;
}

function historyProgressDetails(entry: HistoryProgress): {
  percentage: number | null;
  text: string;
  bar: string | null;
} {
  const progress = projectWatchProgress({
    timestamp: entry.positionSeconds,
    duration: entry.durationSeconds,
    completed: entry.completed,
  });
  if (progress.completed) {
    return {
      percentage: 100,
      text: "watched",
      bar: renderHistoryProgressBar(100),
    };
  }
  if (progress.percentage !== null) {
    const percentage = progress.percentage;
    return {
      percentage,
      text: `${percentage}% watched`,
      bar: renderHistoryProgressBar(percentage),
    };
  }
  return { percentage: null, text: "position saved", bar: null };
}

function sortHistoryEntries(
  historyEntries: ReadonlyArray<[string, HistoryProgress]>,
): readonly [string, HistoryProgress][] {
  return [...historyEntries].sort(
    (a: [string, HistoryProgress], b: [string, HistoryProgress]) =>
      (new Date(b[1].updatedAt).getTime() || 0) - (new Date(a[1].updatedAt).getTime() || 0),
  );
}

const DAY_MS = 86_400_000;

/** Groups sorted history entries into recency buckets (Today / This Week / Earlier). */
export function groupHistoryByRecency(
  entries: ReadonlyArray<[string, HistoryProgress]>,
): { label: string; items: ReadonlyArray<[string, HistoryProgress]> }[] {
  const now = Date.now();
  const today: [string, HistoryProgress][] = [];
  const week: [string, HistoryProgress][] = [];
  const earlier: [string, HistoryProgress][] = [];

  for (const pair of entries) {
    const age = now - (new Date(pair[1].updatedAt).getTime() || 0);
    if (age < DAY_MS) today.push(pair);
    else if (age < DAY_MS * 7) week.push(pair);
    else earlier.push(pair);
  }

  return [
    ...(today.length ? [{ label: "Today", items: today }] : []),
    ...(week.length ? [{ label: "This Week", items: week }] : []),
    ...(earlier.length ? [{ label: "Earlier", items: earlier }] : []),
  ];
}

export function buildHistoryPanelLines(
  historyEntries: ReadonlyArray<[string, HistoryProgress]>,
): readonly ShellPanelLine[] {
  if (historyEntries.length === 0) {
    return [
      {
        label: "No watch history yet",
        detail:
          "Playback positions appear here after mpv reports a watched position or EOF duration. If this stays empty after playback, open Diagnostics and check for a skipped history save.",
      },
    ];
  }

  const sorted = sortHistoryEntries(historyEntries).slice(0, 30);
  const groups = groupHistoryByRecency(sorted);
  const lines: ShellPanelLine[] = [];

  for (const group of groups) {
    lines.push({ label: `─── ${group.label}`, detail: "", tone: "info" });
    for (const [titleId, entry] of group.items) {
      const details = historyProgressDetails(entry);
      const initial = entry.title.trim().charAt(0).toUpperCase() || "?";
      lines.push({
        label:
          historyContentType(entry) === "series"
            ? `${initial}  ${entry.title}  ·  S${String(entry.season ?? 1).padStart(2, "0")}E${String(entry.episode ?? entry.absoluteEpisode ?? 1).padStart(2, "0")}`
            : `${initial}  ${entry.title}  ·  movie`,
        detail: `${details.bar ? `${details.bar} ` : ""}${details.text}  ·  provider ${entry.providerId ?? "unknown"}  ·  id ${titleId}  ·  ${new Date(entry.updatedAt).toLocaleDateString()}`,
      });
    }
  }

  return lines;
}

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export type HistoryPickerOptionsContext = {
  readonly nextReleases?: ReadonlyMap<string, ContinueHistoryRelease>;
  readonly projections?: ReadonlyMap<string, ContinuationProjection>;
  // Authoritative release status per title (status + newEpisodeCount + releaseAt),
  // sourced directly from the ReleaseProgressProjection cache — NOT the lossy
  // ContinueHistoryRelease — so the `caught-up` signal survives for bucketing.
  readonly releaseSignals?: ReadonlyMap<string, HistoryReleaseSignal>;
};

/**
 * Single authority for which /history tab a title belongs in. Decides off the
 * honest release status via {@link classifyHistoryBucket}, never the optimistic
 * reconcile fallback. Used by both the Continue/Completed/New tabs and the hoisted
 * "Continue Watching" section so they can never disagree.
 */
export function historyBucketFor(
  id: string,
  entry: HistoryProgress,
  context: HistoryPickerOptionsContext = {},
): HistoryBucket {
  const projection = context.projections?.get(id);
  const hasKnownNextToPlay =
    projection?.kind === "offline-ready" || projection?.kind === "next-released";
  return classifyHistoryBucket({
    entry,
    release: context.releaseSignals?.get(id) ?? null,
    hasKnownNextToPlay,
  });
}

function formatSeriesEpisode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function buildHistoryOptionRow(
  id: string,
  entry: HistoryProgress,
  context: HistoryPickerOptionsContext,
): ShellPickerOption<string> {
  const details = historyProgressDetails(entry);
  const isCompleted = projectWatchProgress({
    timestamp: entry.positionSeconds,
    duration: entry.durationSeconds,
    completed: entry.completed,
  }).completed;
  const projection = context.projections?.get(id);
  const entrySeason = entry.season ?? 1;
  const entryEpisode = entry.episode ?? entry.absoluteEpisode ?? 1;
  const episode =
    historyContentType(entry) === "series"
      ? formatSeriesEpisode(entrySeason, entryEpisode)
      : "movie";
  if (projection?.kind === "offline-ready") {
    const directLocalPlay =
      projection.primaryAction?.kind === "play-local" && Boolean(projection.primaryAction.jobId);
    return {
      value: id,
      label: `${entry.title}  ·  ${formatSeriesEpisode(projection.season, projection.episode)}`,
      detail: `${directLocalPlay ? "enter plays downloaded episode" : "download ready in /library"}  ·  ${projection.badge ?? "next episode ready"}  ·  completed ${episode}  ·  ${relativeTime(new Date(entry.updatedAt))}`,
      badge: projection.badge ?? "offline",
      tone: "success",
      posterTitle: entry.title,
    };
  }
  const decision = reconcileContinueHistory({
    titleId: id,
    entries: [[id, entry]],
    nextRelease: context.nextReleases?.get(id) ?? null,
  });
  // Gate the legacy reconcile's "new-episode" through the authoritative bucket so a
  // finished/caught-up title (or one with missing/stale release data) never shows a
  // fabricated "new" badge — the bucket classifier is conservative where reconcile is
  // optimistic. Without this, completed shows render "new" (the reported bug).
  const isNewEpisodeRow =
    decision.kind === "new-episode" && historyBucketFor(id, entry, context) === "new-episodes";
  if (isNewEpisodeRow) {
    const nextEpisode =
      typeof decision.episode === "number"
        ? formatSeriesEpisode(decision.season ?? entrySeason, decision.episode)
        : episode;
    const completedEpisode =
      historyContentType(entry) === "series"
        ? formatSeriesEpisode(entrySeason, entryEpisode)
        : "movie";
    const timeAgo = relativeTime(new Date(entry.updatedAt));
    const returnLoopDetail = describeHistoryReturnLoopDetail({
      entry,
      nextRelease: context.nextReleases?.get(id) ?? null,
    });
    return {
      value: id,
      label: `${entry.title}  ·  ${nextEpisode}`,
      detail: `${returnLoopDetail}  ·  completed ${completedEpisode}  ·  ${entry.providerId ?? "unknown"}  ·  ${timeAgo}`,
      badge: projection?.badge ?? "new",
      tone: "success",
      posterTitle: entry.title,
    };
  }
  const statusGlyph = isCompleted
    ? "✓ complete"
    : entry.positionSeconds > 10
      ? `⏸ ${formatTimestamp(entry.positionSeconds)}`
      : "▶ start";
  const timeAgo = relativeTime(new Date(entry.updatedAt));

  return {
    value: id,
    label:
      historyContentType(entry) === "series"
        ? `${entry.title}  ·  ${episode}`
        : `${entry.title}  ·  movie`,
    detail: `${statusGlyph}  ·  ${entry.providerId ?? "unknown"}  ·  ${timeAgo}`,
    posterTitle: entry.title,
    historyProgress:
      details.percentage !== null
        ? { percentage: details.percentage, completed: isCompleted }
        : undefined,
    tone: isCompleted
      ? "success"
      : details.percentage !== null && details.percentage < 90
        ? "warning"
        : "neutral",
  };
}

/**
 * Single authority for "this title is something to keep watching" — the predicate
 * behind both the hoisted "Continue Watching" section and the /history Continue tab,
 * so the two surfaces can never disagree.
 *
 * Keep-watching = an in-progress title (resume) OR a finished SERIES episode that has
 * a next episode to play (Netflix-style advance). Finished movies and caught-up series
 * are done — they belong in Completed, not here.
 */
function isHistoryKeepWatching(
  id: string,
  entry: HistoryProgress,
  context: HistoryPickerOptionsContext = {},
): boolean {
  // The hoisted "Continue Watching" section is everything ACTIONABLE right now —
  // an in-progress resume (continue) OR a freshly-aired next episode (new-episodes).
  // This is broader than the /history Continue *tab* (which is strictly the
  // `continue` bucket, since New episodes has its own tab).
  const bucket = historyBucketFor(id, entry, context);
  return bucket === "continue" || bucket === "new-episodes";
}

export function buildHistoryPickerOptions(
  historyEntries: ReadonlyArray<[string, HistoryProgress]>,
  context: HistoryPickerOptionsContext = {},
): readonly ShellPickerOption<string>[] {
  const sorted = sortHistoryEntries(historyEntries);
  const continueWatching = sorted
    .filter(([id, entry]) => isHistoryKeepWatching(id, entry, context))
    .sort(([leftId], [rightId]) => {
      const rank = (id: string) => {
        const kind = context.projections?.get(id)?.kind;
        if (kind === "resume-unfinished") return 0;
        if (kind === "offline-ready") return 1;
        if (kind === "next-released") return 2;
        return 3;
      };
      return rank(leftId) - rank(rightId);
    });
  const continueIds = new Set(continueWatching.map(([id]) => id));
  const remainder = sorted.filter(([id]) => !continueIds.has(id));

  const options: ShellPickerOption<string>[] = [];

  if (continueWatching.length > 0) {
    options.push({
      value: "section:history-continue-watching",
      label: "Continue Watching",
    });
    for (const [id, entry] of continueWatching) {
      options.push(buildHistoryOptionRow(id, entry, context));
    }
  }

  const groups = groupHistoryByRecency(remainder);

  if (groups.length <= 1 && continueWatching.length === 0) {
    return remainder.map(([id, entry]) => buildHistoryOptionRow(id, entry, context));
  }

  if (groups.length <= 1) {
    for (const [id, entry] of remainder) {
      options.push(buildHistoryOptionRow(id, entry, context));
    }
    return options;
  }

  for (const group of groups) {
    options.push({
      value: `section:history-${group.label.toLowerCase().replace(/\s+/g, "-")}`,
      label: group.label,
    });
    for (const [id, entry] of group.items) {
      options.push(buildHistoryOptionRow(id, entry, context));
    }
  }
  return options;
}

export function sortProvidersByConfigPriority({
  providers,
  priority,
}: {
  providers: readonly ProviderMetadata[];
  priority: readonly string[];
}): ProviderMetadata[] {
  const rank = new Map<string, number>();
  priority.forEach((providerId, index) => {
    if (!rank.has(providerId)) rank.set(providerId, index);
  });
  return [...providers].sort(
    (left, right) =>
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function buildProviderMemoryPanelLines(input: {
  readonly providers: readonly ProviderMetadata[];
  readonly getProviderHealth: (providerId: ProviderId) => ProviderHealth | undefined;
  readonly mode: SessionState["mode"];
}): readonly ShellPanelLine[] {
  const laneProviders = input.providers.filter(
    (provider) => provider.isAnimeProvider === (input.mode === "anime"),
  );
  if (laneProviders.length === 0) {
    return [{ label: "Provider memory", detail: "No providers registered for this mode" }];
  }

  const lines: ShellPanelLine[] = [
    {
      label: "Provider memory",
      detail: `Active ${input.mode} lane · use /reset-provider-health to forget failures`,
      tone: "info",
    },
  ];

  for (const provider of laneProviders) {
    const effective = resolveEffectiveProviderHealth(
      input.getProviderHealth(provider.id as ProviderId),
    );
    const badge = formatProviderHealthBadge(effective ?? undefined);
    const fallbackNote =
      effective && !isProviderFallbackEligible(effective) ? " · skipped in auto-fallback" : "";
    lines.push({
      label: formatProviderName(provider),
      detail: badge ? `${badge}${fallbackNote}` : "no failure memory",
      tone:
        effective?.effectiveStatus === "down"
          ? "error"
          : effective?.effectiveStatus === "degraded"
            ? "warning"
            : "neutral",
    });
  }

  lines.push({
    label: "Recovery tips",
    detail: "/recompute ignores health for one attempt · degraded heals after ~1h · down after ~8h",
    tone: "neutral",
  });

  return lines;
}

export function buildProviderPickerOptions({
  providers,
  currentProvider,
  previewImageUrl,
  getProviderHealth,
}: {
  providers: readonly ProviderMetadata[];
  currentProvider: string;
  previewImageUrl?: string;
  getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
}): readonly ShellPickerOption<string>[] {
  return providers.map((provider) => {
    const effective = getProviderHealth
      ? resolveEffectiveProviderHealth(getProviderHealth(provider.id as ProviderId))
      : undefined;
    const healthBadge = formatProviderHealthBadge(effective ?? undefined);
    const healthLabelSuffix = formatProviderHealthPickerLabelSuffix(effective ?? undefined);
    const healthDetail = healthBadge ? `Health: ${healthBadge}` : null;
    const baseDetail = formatProviderDetail(provider);
    const baseLabel =
      provider.id === currentProvider
        ? `${formatProviderName(provider)}  ·  current`
        : formatProviderName(provider);
    return {
      value: provider.id,
      label: healthLabelSuffix ? `${baseLabel}${healthLabelSuffix}` : baseLabel,
      detail: [baseDetail, healthDetail].filter(Boolean).join("  ·  "),
      previewImageUrl,
    };
  });
}

function formatProviderName(provider: ProviderMetadata): string {
  const status = provider.status === "candidate" ? "candidate" : null;
  return status ? `${provider.name}  ·  ${status}` : provider.name;
}

function formatProviderDetail(provider: ProviderMetadata): string {
  const aliases = provider.aliases?.length ? `Known as ${provider.aliases.join(", ")}` : null;
  return [provider.description, aliases].filter(Boolean).join("  ·  ");
}
