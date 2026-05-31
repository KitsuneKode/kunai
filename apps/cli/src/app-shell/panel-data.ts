import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
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
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import { describePresenceConfiguration } from "@/services/presence/PresenceServiceImpl";
import type { CapabilitySnapshot } from "@/ui";
import type { HistoryProgress } from "@kunai/storage";
import type { NotificationRecord } from "@kunai/storage";

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
  return [
    // ── Global (always available) ──
    { label: "─── Always available", detail: "", tone: "info" },
    { label: "/", detail: "Open command palette — search all commands" },
    { label: "?", detail: "Open help" },
    { label: "Esc", detail: "Close panel · clear filter · go back" },
    { label: "Ctrl+A / E", detail: "Jump to start / end of input" },
    { label: "Ctrl+W", detail: "Delete word backward" },
    { label: "Ctrl+← →", detail: "Move cursor by word" },

    // ── While browsing ──
    { label: "─── While browsing", detail: "", tone: "info" },
    { label: "↑↓ / Enter", detail: "Navigate results · open selected title" },
    { label: "Tab", detail: "Switch between series and anime mode" },
    { label: "Ctrl+T", detail: "Reload trending results" },
    { label: "Ctrl+D", detail: "Download highlighted title" },
    { label: "g", detail: "Open recommendations panel" },
    { label: "/history", detail: "Resume from recent progress" },
    { label: "/wl", detail: "View and manage your watchlist" },
    { label: "/playlist", detail: "View and manage your playback queue" },
    { label: "/stats", detail: "Watch statistics and streak" },

    // ── During / after playback ──
    { label: "─── During and after playback", detail: "", tone: "info" },
    { label: "n / p", detail: "Next / previous episode" },
    { label: "r", detail: "Replay current episode" },
    { label: "a", detail: "Toggle autoplay on / off" },
    { label: "u", detail: "Toggle intro auto-skip" },
    { label: "f", detail: "Try fallback provider" },
    { label: "e", detail: "Open episode picker" },
    { label: "o", detail: "Switch stream source" },
    { label: "v", detail: "Change quality" },
    { label: "k", detail: "View available streams" },
    { label: "d", detail: "Download current episode" },
    { label: "i", detail: "Recommendation actions for post-playback picks" },

    // ── Panels & Commands ──
    { label: "─── Panels & Commands", detail: "", tone: "info" },
    { label: "/notifications", detail: "App notices · new episodes · queue recovery" },
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

export function buildNotificationPanelLines(
  notifications: readonly NotificationRecord[],
): readonly ShellPanelLine[] {
  if (notifications.length === 0) {
    return [
      {
        label: "No notifications",
        detail:
          "New episodes, recoverable queues, downloads, and app notices appear here. Enter to act on one, x to dismiss, a to see all actions.",
        tone: "neutral",
      },
    ];
  }

  return notifications.map((notification) => ({
    label: notification.title,
    detail: notification.body,
    tone:
      notification.kind === "queue-recovery"
        ? "warning"
        : notification.kind === "new-episode"
          ? "success"
          : "info",
  }));
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
  presenceSnapshot,
  memorySamples,
}: {
  state: SessionState;
  recentEvents: readonly DiagnosticEvent[];
  capabilitySnapshot?: CapabilitySnapshot | null;
  downloadSummary?: { active: number; completed: number; failed?: number } | null;
  presenceSnapshot?: PresenceSnapshot | null;
  memorySamples?: readonly RuntimeMemorySample[];
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
  });
  const healthSummary = buildDiagnosticsHealthSummary({
    state,
    recentEvents,
    downloadSummary,
    presenceSnapshot,
    runtimeProviderLine: runtimeHealth.provider,
    runtimeNetworkLine: runtimeHealth.network,
    runtimeMemoryLine: runtimeHealth.memory,
    runtimeMemoryTrendLine: runtimeHealth.memoryTrend,
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
    {
      label: "Resolve trace",
      detail: (() => {
        const attempts = formatProviderAttemptEvidence(recentEvents);
        if (attempts !== "no physical provider attempts yet") return attempts;
        return formatProviderTimelineEvent(providerTimelineEvent);
      })(),
      tone: providerVerdictTone,
    },
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
  presenceSnapshot,
  runtimeProviderLine,
  runtimeNetworkLine,
  runtimeMemoryLine,
  runtimeMemoryTrendLine,
}: {
  state: SessionState;
  recentEvents: readonly DiagnosticEvent[];
  downloadSummary?: { active: number; completed: number; failed?: number } | null;
  presenceSnapshot?: PresenceSnapshot | null;
  runtimeProviderLine: ShellPanelLine;
  runtimeNetworkLine: ShellPanelLine;
  runtimeMemoryLine: ShellPanelLine;
  runtimeMemoryTrendLine: ShellPanelLine;
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
};

function formatSeriesEpisode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function isHistoryPickerContinuable(
  titleId: string,
  entry: HistoryProgress,
  context: HistoryPickerOptionsContext = {},
): boolean {
  // Movies are always actionable: resume if in progress, restart if completed.
  if (historyContentType(entry) === "movie") return true;
  const projection = context.projections?.get(titleId);
  if (
    projection?.kind === "resume-unfinished" ||
    projection?.kind === "offline-ready" ||
    projection?.kind === "next-released"
  ) {
    return true;
  }
  const isCompleted = projectWatchProgress({
    timestamp: entry.positionSeconds,
    duration: entry.durationSeconds,
    completed: entry.completed,
  }).completed;
  if (!isCompleted) return true;
  return (
    reconcileContinueHistory({
      titleId,
      entries: [[titleId, entry]],
      nextRelease: context.nextReleases?.get(titleId) ?? null,
    }).kind === "new-episode"
  );
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
  if (decision.kind === "new-episode") {
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
export function isHistoryKeepWatching(
  id: string,
  entry: HistoryProgress,
  context: HistoryPickerOptionsContext = {},
): boolean {
  const projection = context.projections?.get(id);
  if (projection?.kind === "offline-ready" || projection?.kind === "next-released") return true;
  const isCompleted = projectWatchProgress({
    timestamp: entry.positionSeconds,
    duration: entry.durationSeconds,
    completed: entry.completed,
  }).completed;
  if (isCompleted) {
    return (
      reconcileContinueHistory({
        titleId: id,
        entries: [[id, entry]],
        nextRelease: context.nextReleases?.get(id) ?? null,
      }).kind === "new-episode"
    );
  }
  return isHistoryPickerContinuable(id, entry, context);
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

export function buildProviderPickerOptions({
  providers,
  currentProvider,
}: {
  providers: readonly ProviderMetadata[];
  currentProvider: string;
}): readonly ShellPickerOption<string>[] {
  return providers.map((provider) => ({
    value: provider.id,
    label:
      provider.id === currentProvider
        ? `${formatProviderName(provider)}  ·  current`
        : formatProviderName(provider),
    detail: formatProviderDetail(provider),
  }));
}

function formatProviderName(provider: ProviderMetadata): string {
  const status = provider.status === "candidate" ? "candidate" : null;
  return status ? `${provider.name}  ·  ${status}` : provider.name;
}

function formatProviderDetail(provider: ProviderMetadata): string {
  const aliases = provider.aliases?.length ? `Known as ${provider.aliases.join(", ")}` : null;
  return [provider.description, aliases].filter(Boolean).join("  ·  ");
}
