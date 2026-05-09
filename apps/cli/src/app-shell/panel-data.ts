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
  if (state.subLang === "none") {
    return { label: "disabled by preference", tone: "neutral" };
  }
  if (!state.stream) {
    return { label: "not resolved yet", tone: "neutral" };
  }
  const label = describePlaybackSubtitleStatus(state.stream, state.subLang);
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
    {
      label: "Commands",
      detail: "/ opens the command palette when the current surface supports extra actions.",
    },
    {
      label: "Close",
      detail: "Esc clears a filter first, then closes the top panel. It never confirms playback.",
    },
    {
      label: "Confirm",
      detail: "Enter searches changed queries or confirms the highlighted picker/result row.",
    },
    {
      label: "Browse",
      detail: "↑↓ moves results. Tab switches destination mode. Ctrl+T reloads trending.",
    },
    {
      label: "Pickers",
      detail: "Type to filter providers, episodes, seasons, subtitles, history, and settings.",
    },
    {
      label: "Editing",
      detail: "Ctrl+A/E jumps to start/end. Ctrl+W deletes a word. Ctrl+←/→ moves by word.",
    },
    {
      label: "Playback",
      detail: "n/p navigate episodes. k/o/v choose streams. r recovers. f tries fallback.",
    },
    {
      label: "Diagnostics",
      detail: "/diagnostics inspects state. /export-diagnostics writes a redacted support bundle.",
    },
    {
      label: "Presence",
      detail:
        "/presence opens Discord setup. It uses local IPC only; no stream URLs or headers are sent.",
    },
    {
      label: "Report issue",
      detail: "/report-issue opens GitHub issue reporting. Attach the exported diagnostics file.",
    },
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
          : downloadFeature.status === "missing-ffmpeg"
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
    {
      label: "Support bundle",
      detail: "/export-diagnostics writes redacted recent events into the current directory.",
      tone: "neutral",
    },
    {
      label: "Report issue",
      detail: "/report-issue opens GitHub. Attach the exported bundle, provider, OS, and command.",
      tone: "neutral",
    },
    {
      label: "Mode and provider",
      detail: `${state.mode}  ·  ${state.provider}`,
    },
    {
      label: "View and playback",
      detail: `${state.view}  ·  ${state.playbackStatus}`,
    },
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
    {
      label: "Subtitle state",
      detail: subtitleState.label,
      tone: subtitleState.tone,
    },
    {
      label: "Selected subtitle URL",
      detail: state.stream?.subtitle ? "[redacted-url attached]" : subtitleState.label,
    },
    {
      label: "Subtitle tracks",
      detail: String(state.stream?.subtitleList?.length ?? 0),
    },
    {
      label: "Subtitle source",
      detail: state.stream?.subtitleSource ?? "none",
    },
    {
      label: "Subtitle evidence",
      detail: state.stream?.subtitleEvidence
        ? summarizeJson(state.stream.subtitleEvidence)
        : "no subtitle evidence recorded yet",
      tone: state.stream?.subtitleEvidence ? "neutral" : "warning",
    },
    {
      label: "Subtitle diagnosis",
      detail: state.stream?.subtitle
        ? "A subtitle URL was attached before mpv launched."
        : state.subLang === "none"
          ? "Subtitle preference is set to none, so mpv launches without a subtitle file by design."
          : "For Vidking, this usually means the embed did not request a direct subtitle file or Wyzie search before the stream was captured, or the subtitle provider had no match.",
      tone: state.stream?.subtitle ? "success" : "warning",
    },
    {
      label: "Stream URL",
      detail: state.stream?.url ? "[redacted-url resolved]" : "not resolved yet",
    },
    {
      label: "Header keys",
      detail: summarizeHeaderKeys(state.stream?.headers),
    },
    {
      label: "Search state",
      detail: `${state.searchState}  ·  ${state.searchResults.length} results`,
    },
    {
      label: "Memory",
      detail: `RSS ${(process.memoryUsage().rss / 1_048_576).toFixed(1)} MB`,
    },
    {
      label: "Presence",
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
    {
      label: "Startup capabilities",
      detail:
        capabilitySnapshot?.issues.length && capabilitySnapshot.issues.length > 0
          ? capabilitySnapshot.issues
              .map((issue) => `${issue.id} (${issue.severity})`)
              .join("  ·  ")
          : `mpv ${capabilitySnapshot?.mpv ? "ready" : "missing"}  ·  ffmpeg ${capabilitySnapshot?.ffmpeg ? "ready" : "missing"}  ·  chafa ${capabilitySnapshot?.chafa ? "ready" : "missing"}  ·  magick ${capabilitySnapshot?.magick ? "ready" : "missing"}  ·  image ${capabilitySnapshot?.image.renderer ?? "unknown"} (${capabilitySnapshot?.image.terminal ?? "unknown"})`,
      tone: capabilitySnapshot?.issues.length ? "warning" : "success",
    },
    {
      label: "Download queue",
      detail: downloadSummary
        ? `${downloadSummary.active} active  ·  ${downloadSummary.failed ?? 0} failed  ·  ${downloadSummary.completed} completed`
        : "queue status unavailable",
      tone: downloadSummary && downloadSummary.active > 0 ? "info" : "neutral",
    },
    {
      label: "mpv buffering",
      detail: formatMpvRuntimeDetail(bufferingEvent),
      tone: bufferingEvent ? "warning" : "neutral",
    },
    {
      label: "mpv stream stall",
      detail: formatMpvRuntimeDetail(streamStallEvent),
      tone: streamStallEvent ? "warning" : "neutral",
    },
    {
      label: "mpv seek stall",
      detail: formatMpvRuntimeDetail(seekStallEvent),
      tone: seekStallEvent ? "warning" : "neutral",
    },
    {
      label: "mpv IPC stall",
      detail: formatMpvRuntimeDetail(ipcStallEvent),
      tone: ipcStallEvent ? "warning" : "neutral",
    },
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
    const resumeState = isCompleted
      ? "replay starts from beginning"
      : entry.timestamp > 10
        ? `resume ${formatTimestamp(entry.timestamp)}`
        : "start from beginning";

    return {
      value: id,
      label: entry.type === "series" ? `${entry.title}  ·  ${episode}` : `${entry.title}  ·  movie`,
      detail: `${resumeState}  ·  provider ${entry.provider}  ·  ${new Date(entry.watchedAt).toLocaleDateString()}`,
      badge: details.bar ? `${details.bar} ${details.percentage}%` : "saved",
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
