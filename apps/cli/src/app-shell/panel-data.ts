import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
import type { SessionState } from "@/domain/session/SessionState";
import type { ProviderMetadata } from "@/domain/types";
import type { DiagnosticEvent } from "@/services/diagnostics/DiagnosticsStore";
import { buildRuntimeHealthSnapshot } from "@/services/diagnostics/runtime-health";
import { resolveDownloadFeatureState } from "@/services/download/DownloadFeature";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { formatTimestamp, type HistoryEntry } from "@/services/persistence/HistoryStore";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import { describePresenceConfiguration } from "@/services/presence/PresenceServiceImpl";
import type { CapabilitySnapshot } from "@/ui";

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

export function buildHelpPanelLines(): readonly ShellPanelLine[] {
  return [
    // ── Navigation ──
    { label: "─── Navigation", detail: "", tone: "info" },
    { label: "↑↓", detail: "Browse results, navigate pickers" },
    { label: "Enter", detail: "Select result, confirm highlighted item" },
    { label: "Esc", detail: "Clear filter first, then close panel" },
    { label: "Tab", detail: "Switch between series and anime mode" },
    { label: "Ctrl+A/E", detail: "Jump to start/end of input" },
    { label: "Ctrl+W", detail: "Delete word backward" },
    { label: "Ctrl+←/→", detail: "Move cursor by word" },

    // ── Playback ──
    { label: "─── Playback", detail: "", tone: "info" },
    { label: "n", detail: "Next episode" },
    { label: "p", detail: "Previous episode" },
    { label: "r", detail: "Replay current episode" },
    { label: "a", detail: "Toggle autoplay" },
    { label: "u", detail: "Toggle auto-skip intros" },
    { label: "f", detail: "Try fallback provider" },

    // ── Media ──
    { label: "─── Media", detail: "", tone: "info" },
    { label: "e", detail: "Open episode picker" },
    { label: "o", detail: "Switch stream source" },
    { label: "v", detail: "Change quality" },
    { label: "k", detail: "View available streams" },

    // ── Panels ──
    { label: "─── Panels", detail: "", tone: "info" },
    { label: "/", detail: "Open command palette" },
    { label: "/history", detail: "Continue from recent progress" },
    { label: "?", detail: "This help panel" },
    { label: "i", detail: "Diagnostics panel" },
    { label: "g", detail: "Recommendations" },

    // ── Settings & Tools ──
    { label: "─── Settings", detail: "", tone: "info" },
    { label: "/settings", detail: "Open settings editor" },
    { label: "/setup", detail: "Run dependency setup wizard" },
    { label: "/presence", detail: "Discord presence configuration" },
    { label: "Ctrl+T", detail: "Reload trending results" },

    // ── Downloads ──
    { label: "─── Downloads", detail: "", tone: "info" },
    { label: "Ctrl+D", detail: "Download highlighted title from browse" },
    { label: "/downloads", detail: "Manage queued, running, and failed jobs" },
    { label: "/library", detail: "Play completed local downloads" },
    { label: "/offline", detail: "Alias for the playable offline library" },
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
  presenceSnapshot,
}: {
  state: SessionState;
  recentEvents: readonly DiagnosticEvent[];
  capabilitySnapshot?: CapabilitySnapshot | null;
  downloadSummary?: { active: number; completed: number; failed?: number } | null;
  presenceSnapshot?: PresenceSnapshot | null;
}): readonly ShellPanelLine[] {
  const subtitleState = describeSubtitleState(state);
  const bufferingEvent = findRecentMpvEvent(recentEvents, "network-buffering");
  const streamStallEvent = findRecentMpvEvent(recentEvents, "stream-stalled");
  const seekStallEvent = findRecentMpvEvent(recentEvents, "seek-stalled");
  const ipcStallEvent = findRecentMpvEvent(recentEvents, "ipc-stalled");
  const presenceEvent = recentEvents.find((event) => event.category === "presence");
  const runtimeHealth = buildRuntimeHealthSnapshot({
    recentEvents,
    currentProvider: state.provider,
  });

  return [
    // ── Session ──
    { label: "─── Session", detail: "", tone: "info" },
    { label: "Mode", detail: `${state.mode}  ·  ${state.provider}` },
    { label: "View", detail: `${state.view}  ·  ${state.playbackStatus}` },
    { label: "Search", detail: `${state.searchState}  ·  ${state.searchResults.length} results` },

    // ── Provider ──
    { label: "─── Provider", detail: "", tone: "info" },
    runtimeHealth.provider,
    runtimeHealth.network,
    {
      label: "Playback problem",
      detail: state.playbackProblem
        ? `${state.playbackProblem.stage}  ·  ${state.playbackProblem.cause}  ·  ${state.playbackProblem.recommendedAction}`
        : "none recorded",
      tone:
        state.playbackProblem?.severity === "blocking"
          ? "error"
          : state.playbackProblem
            ? "warning"
            : "success",
    },

    // ── Stream ──
    { label: "─── Stream", detail: "", tone: "info" },
    {
      label: "Stream URL",
      detail: state.stream?.url ? "[redacted-url resolved]" : "not resolved yet",
    },
    { label: "Header keys", detail: summarizeHeaderKeys(state.stream?.headers) },

    // ── Subtitles ──
    { label: "─── Subtitles", detail: "", tone: "info" },
    { label: "State", detail: subtitleState.label, tone: subtitleState.tone },
    {
      label: "URL",
      detail: state.stream?.subtitle ? "[redacted-url attached]" : subtitleState.label,
    },
    { label: "Tracks", detail: String(state.stream?.subtitleList?.length ?? 0) },
    { label: "Source", detail: state.stream?.subtitleSource ?? "none" },
    {
      label: "Evidence",
      detail: state.stream?.subtitleEvidence
        ? summarizeJson(state.stream.subtitleEvidence)
        : "no evidence yet",
      tone: state.stream?.subtitleEvidence ? "neutral" : "warning",
    },

    // ── Network ──
    { label: "─── Network", detail: "", tone: "info" },
    {
      label: "Buffering",
      detail: formatMpvRuntimeDetail(bufferingEvent),
      tone: bufferingEvent ? "warning" : "neutral",
    },
    {
      label: "Stream stall",
      detail: formatMpvRuntimeDetail(streamStallEvent),
      tone: streamStallEvent ? "warning" : "neutral",
    },
    {
      label: "Seek stall",
      detail: formatMpvRuntimeDetail(seekStallEvent),
      tone: seekStallEvent ? "warning" : "neutral",
    },
    {
      label: "IPC stall",
      detail: formatMpvRuntimeDetail(ipcStallEvent),
      tone: ipcStallEvent ? "warning" : "neutral",
    },

    // ── Downloads ──
    { label: "─── Downloads", detail: "", tone: "info" },
    {
      label: "Queue",
      detail: downloadSummary
        ? `${downloadSummary.active} active  ·  ${downloadSummary.failed ?? 0} failed  ·  ${downloadSummary.completed} completed`
        : "queue status unavailable",
      tone: downloadSummary && downloadSummary.active > 0 ? "info" : "neutral",
    },

    // ── Presence ──
    { label: "─── Presence", detail: "", tone: "info" },
    {
      label: "Status",
      detail: presenceEvent
        ? `${presenceEvent.message}${presenceEvent.context ? `  ·  ${summarizeJson(presenceEvent.context)}` : ""}`
        : presenceSnapshot
          ? `${presenceSnapshot.provider}  ·  ${presenceSnapshot.status}  ·  ${presenceSnapshot.detail}`
          : "off or not used this session",
      tone:
        presenceSnapshot?.status === "unavailable" || presenceSnapshot?.status === "error"
          ? "warning"
          : presenceEvent
            ? "neutral"
            : "success",
    },

    // ── Runtime ──
    { label: "─── Runtime", detail: "", tone: "info" },
    {
      label: "Capabilities",
      detail:
        capabilitySnapshot?.issues.length && capabilitySnapshot.issues.length > 0
          ? capabilitySnapshot.issues
              .map((issue) => `${issue.id} (${issue.severity})`)
              .join("  ·  ")
          : `mpv ${capabilitySnapshot?.mpv ? "✓" : "✗"}  ·  yt-dlp ${capabilitySnapshot?.ytDlp ? "✓" : "✗"}  ·  chafa ${capabilitySnapshot?.chafa ? "✓" : "✗"}  ·  magick ${capabilitySnapshot?.magick ? "✓" : "✗"}`,
      tone: capabilitySnapshot?.issues.length ? "warning" : "success",
    },
    { label: "Memory", detail: `RSS ${(process.memoryUsage().rss / 1_048_576).toFixed(1)} MB` },

    // ── Support ──
    { label: "─── Support", detail: "", tone: "info" },
    { label: "/export-diagnostics", detail: "Write redacted support bundle" },
    { label: "/report-issue", detail: "Open GitHub issue reporting" },

    // ── Event Log ──
    ...recentEvents.map((event) => ({
      label: `${new Date(event.timestamp).toLocaleTimeString()}  ·  ${event.category}`,
      detail: event.context
        ? `${event.message}  ·  ${summarizeJson(event.context)}`
        : event.message,
    })),
  ];
}

function summarizeJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) =>
    typeof nested === "string" && /^https?:\/\//i.test(nested) ? "[redacted-url]" : nested,
  );
}

function renderProgressBar(percentage: number): string {
  const totalBlocks = 10;
  const filledBlocks = Math.max(
    0,
    Math.min(totalBlocks, Math.round((percentage / 100) * totalBlocks)),
  );
  const emptyBlocks = totalBlocks - filledBlocks;
  return `[${"█".repeat(filledBlocks)}${"░".repeat(emptyBlocks)}]`;
}

function historyProgressDetails(entry: HistoryEntry): {
  percentage: number | null;
  text: string;
  bar: string | null;
} {
  if (entry.duration > 0) {
    const percentage = Math.round((entry.timestamp / entry.duration) * 100);
    return {
      percentage,
      text: `${percentage}% watched`,
      bar: renderProgressBar(percentage),
    };
  }
  return { percentage: null, text: "position saved", bar: null };
}

function sortHistoryEntries(
  historyEntries: ReadonlyArray<[string, HistoryEntry]>,
): readonly [string, HistoryEntry][] {
  return [...historyEntries].sort(
    (a: [string, HistoryEntry], b: [string, HistoryEntry]) =>
      (new Date(b[1].watchedAt).getTime() || 0) - (new Date(a[1].watchedAt).getTime() || 0),
  );
}

export function buildHistoryPanelLines(
  historyEntries: ReadonlyArray<[string, HistoryEntry]>,
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

  return sortHistoryEntries(historyEntries)
    .slice(0, 10)
    .map(([titleId, entry]: [string, HistoryEntry]) => {
      const details = historyProgressDetails(entry);
      return {
        label:
          entry.type === "series"
            ? `${entry.title}  ·  S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}`
            : `${entry.title}  ·  movie`,
        detail: `${details.bar ? `${details.bar} ` : ""}${details.text}  ·  provider ${entry.provider}  ·  id ${titleId}  ·  ${new Date(entry.watchedAt).toLocaleDateString()}`,
      };
    });
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

export function buildHistoryPickerOptions(
  historyEntries: ReadonlyArray<[string, HistoryEntry]>,
): readonly ShellPickerOption<string>[] {
  return sortHistoryEntries(historyEntries).map(([id, entry]: [string, HistoryEntry]) => {
    const details = historyProgressDetails(entry);
    const isCompleted = details.percentage !== null && details.percentage >= 95;
    const episode =
      entry.type === "series"
        ? `S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}`
        : "movie";
    const statusGlyph = isCompleted
      ? "✓ complete"
      : entry.timestamp > 10
        ? `⏸ ${formatTimestamp(entry.timestamp)}`
        : "▶ start";
    const timeAgo = relativeTime(new Date(entry.watchedAt));

    return {
      value: id,
      label: entry.type === "series" ? `${entry.title}  ·  ${episode}` : `${entry.title}  ·  movie`,
      detail: `${statusGlyph}  ·  ${entry.provider}  ·  ${timeAgo}`,
      badge: details.bar ? `${details.bar} ${details.percentage}%` : undefined,
      tone: isCompleted ? "success" : "neutral",
    };
  });
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
