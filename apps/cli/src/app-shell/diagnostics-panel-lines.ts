import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import {
  formatHealthRowDetail,
  type DiagnosticsHealthRow,
  type DiagnosticsInsight,
  type DiagnosticsSubsystem,
} from "@/services/diagnostics/diagnostics-insight";

import {
  buildDiagnosticsPanelModel,
  flattenDiagnosticsPanelSpans,
  resolveDiagnosticsExpandedSpanIds,
} from "./diagnostics-panel.model";
import type { ShellPanelLine } from "./types";

const HEALTH_SUBSYSTEM_LABELS: Record<DiagnosticsSubsystem, string> = {
  playback: "Playback",
  provider: "Provider",
  network: "Network",
  cache: "Cache",
  subtitles: "Subtitles",
  downloads: "Downloads",
  discord: "Discord",
  "release-sync": "Release sync",
  memory: "Memory",
};

export function buildDiagnosticsPanelLinesFromInsight({
  insight,
  developerMode = false,
  expandedSpanIds,
}: {
  insight: DiagnosticsInsight;
  developerMode?: boolean;
  /** When null/undefined, newest span is expanded by default. */
  expandedSpanIds?: ReadonlySet<string> | null;
}): readonly ShellPanelLine[] {
  const verdictTone = severityToTone(insight.sessionVerdict.severity);

  return [
    { label: "─── Verdict", detail: "", tone: "info" },
    {
      label: "Verdict",
      // Same de-duplication as the health rows: the verdict frequently restates
      // its own cause ("unavailable · unavailable"), which buries the one line
      // the user opened this panel to read.
      detail: formatHealthRowDetail({
        label: insight.sessionVerdict.label,
        reason: insight.likelyCause,
        recommendedActionLabel: insight.sessionVerdict.primaryActionLabel,
      } as DiagnosticsHealthRow),
      tone: verdictTone,
    },
    { label: "─── Health", detail: "", tone: "info" },
    ...insight.healthRows.map((row) => healthRowToPanelLine(row)),
    { label: "─── Current Playback Evidence", detail: "", tone: "info" },
    ...buildCurrentPlaybackLines(insight),
    ...buildDecisionTimelineLines(insight, developerMode),
    { label: "─── Developer Evidence", detail: "", tone: "info" },
    ...buildDeveloperEvidenceLines(insight, developerMode, expandedSpanIds),
    { label: "─── Export And Report", detail: "", tone: "info" },
    { label: "/export-diagnostics", detail: "Write a redacted support bundle to disk" },
    { label: "e", detail: "Export support bundle from this overlay (shows path)" },
    { label: "/report-issue", detail: "Open the GitHub issue template with context" },
    {
      label: "kunai diagnostics recent",
      detail: "Print redacted recent events as JSONL or Markdown for agents",
    },
  ];
}

function healthRowToPanelLine(row: DiagnosticsHealthRow): ShellPanelLine {
  return {
    label: HEALTH_SUBSYSTEM_LABELS[row.subsystem],
    detail: formatHealthRowDetail(row),
    tone: severityToTone(row.severity),
  };
}

function buildCurrentPlaybackLines(insight: DiagnosticsInsight): ShellPanelLine[] {
  const evidence = insight.currentPlaybackEvidence;
  return [
    { label: "Title", detail: evidence.title, tone: "neutral" },
    { label: "Episode", detail: evidence.episode, tone: "neutral" },
    { label: "Mode", detail: evidence.mode, tone: "neutral" },
    { label: "Provider", detail: evidence.provider, tone: "neutral" },
    { label: "Playback state", detail: evidence.playbackStatus, tone: "neutral" },
    { label: "Source", detail: evidence.sourceState, tone: "neutral" },
    { label: "Cache", detail: evidence.cacheState, tone: "neutral" },
    { label: "Subtitles", detail: evidence.subtitleOutcome, tone: "neutral" },
    { label: "Recover", detail: evidence.recoverStatus, tone: "neutral" },
    {
      label: "Slowest startup stage",
      detail: evidence.slowestStartupStage,
      tone: "neutral",
    },
  ];
}

function buildDeveloperEvidenceLines(
  insight: DiagnosticsInsight,
  developerMode: boolean,
  expandedSpanIds?: ReadonlySet<string> | null,
): ShellPanelLine[] {
  const dev = insight.developerEvidence;
  const correlationParts = [
    dev.correlation.sessionId ? `session ${compactId(dev.correlation.sessionId)}` : null,
    dev.correlation.playbackCycleId ? `cycle ${compactId(dev.correlation.playbackCycleId)}` : null,
    dev.correlation.providerAttemptId
      ? `provider ${compactId(dev.correlation.providerAttemptId)}`
      : null,
    dev.correlation.traceId ? `trace ${compactId(dev.correlation.traceId)}` : null,
    dev.correlation.spanId ? `span ${compactId(dev.correlation.spanId)}` : null,
  ].filter(Boolean);

  const lines: ShellPanelLine[] = [
    {
      label: "Correlation",
      detail:
        correlationParts.length > 0 ? correlationParts.join("  ·  ") : "no active correlation yet",
      tone: "neutral",
    },
    {
      label: "Provider timeline",
      detail: dev.providerTimeline,
      tone: "neutral",
    },
    {
      label: "Provider attempts",
      detail: dev.providerAttempts,
      tone: "neutral",
    },
  ];

  if (dev.sourceAttempts) {
    lines.push({
      label: "Source attempts",
      detail: dev.sourceAttempts,
      tone: dev.sourceAttempts.includes("failed") ? "warning" : "info",
    });
  }

  lines.push({
    label: "Playback startup",
    detail: dev.playbackStartup,
    tone: "neutral",
  });

  if (dev.sourceInventoryWarnings.length > 0) {
    lines.push({
      label: "Source inventory warnings",
      detail: dev.sourceInventoryWarnings.join("  ·  "),
      tone: "warning",
    });
  }

  if (dev.networkEvents.length > 0) {
    lines.push({
      label: "mpv/network",
      detail: dev.networkEvents.join("  ·  "),
      tone: "neutral",
    });
  }

  lines.push(...buildRecentSpanLines(dev.recentEvents, developerMode, expandedSpanIds));

  return lines;
}

function buildRecentSpanLines(
  recentEvents: readonly DiagnosticEvent[],
  developerMode: boolean,
  expandedSpanIds?: ReadonlySet<string> | null,
): readonly ShellPanelLine[] {
  const eventLimit = developerMode ? 40 : 16;
  const boundedEvents = recentEvents.slice(0, eventLimit);
  const model = buildDiagnosticsPanelModel({ recentEvents: boundedEvents });

  if (model.spans.length === 0) {
    return [
      {
        label: "Recent events",
        detail: "newest first",
        tone: "info",
      },
      ...formatDiagnosticTimelineLines(boundedEvents, developerMode ? 20 : 8),
    ];
  }

  const expanded = resolveDiagnosticsExpandedSpanIds(model, expandedSpanIds);
  return [
    {
      label: "Recent spans",
      detail: "newest cycle first  ·  Space toggles",
      tone: "info",
    },
    ...flattenDiagnosticsPanelSpans(model, expanded),
  ];
}

/**
 * Decision-family operations: rows that explain WHY the runtime chose a path
 * (continue local vs stream, provider pick, recovery, fallback), separated
 * from raw event noise so users can audit behavior without developer mode.
 */
function isDecisionEvent(event: DiagnosticEvent): boolean {
  const operation = event.operation ?? "";
  return (
    operation.startsWith("continuation.") ||
    operation.includes("decision") ||
    operation === "provider.resolve.fallback"
  );
}

function buildDecisionTimelineLines(
  insight: DiagnosticsInsight,
  developerMode: boolean,
): ShellPanelLine[] {
  const decisions = insight.developerEvidence.recentEvents.filter(isDecisionEvent);
  if (decisions.length === 0) return [];
  return [
    { label: "─── Recent Decisions", detail: "", tone: "info" },
    ...decisions.slice(0, developerMode ? 12 : 6).map((event) => ({
      label: `${event.category}.${event.operation}`,
      detail: [event.message, formatTimelineCorrelation(event)].filter(Boolean).join("  ·  "),
      tone: (event.level === "error"
        ? "error"
        : event.level === "warn"
          ? "warning"
          : "neutral") as ShellPanelLine["tone"],
    })),
  ];
}

function formatDiagnosticTimelineLines(
  recentEvents: readonly DiagnosticEvent[],
  limit: number,
): readonly ShellPanelLine[] {
  if (recentEvents.length === 0) {
    return [{ label: "No events", detail: "No diagnostic events recorded yet", tone: "neutral" }];
  }

  return recentEvents.slice(0, limit).map((event) => ({
    label: `${new Date(event.timestamp).toISOString()} [${event.level}]`,
    detail: [
      `${event.category}.${event.operation}`,
      event.message,
      formatTimelineCorrelation(event),
    ]
      .filter(Boolean)
      .join("  ·  "),
    tone: event.level === "error" ? "error" : event.level === "warn" ? "warning" : "neutral",
  }));
}

function formatTimelineCorrelation(event: DiagnosticEvent): string {
  return [
    event.sessionId ? `session ${compactId(event.sessionId)}` : null,
    event.playbackCycleId ? `cycle ${compactId(event.playbackCycleId)}` : null,
    event.providerAttemptId ? `provider ${compactId(event.providerAttemptId)}` : null,
    event.traceId ? `trace ${compactId(event.traceId)}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
}

function compactId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function severityToTone(
  severity: DiagnosticsInsight["sessionVerdict"]["severity"],
): ShellPanelLine["tone"] {
  switch (severity) {
    case "healthy":
      return "success";
    case "degraded":
    case "recoverable":
      return "warning";
    case "blocked":
      return "error";
    default:
      return "neutral";
  }
}
