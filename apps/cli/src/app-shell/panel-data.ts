import type { SessionState } from "@/domain/session/SessionState";
import type { ProviderMetadata } from "@/domain/types";
import type { DiagnosticEvent } from "@/services/diagnostics/DiagnosticsStore";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";

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
  if (state.stream.subtitle) {
    return { label: "attached", tone: "success" };
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
      label: "/ Command bar",
      detail:
        "Open global actions from anywhere in the shell. Use Tab to autocomplete, ↑↓ to choose, and Enter to run the highlighted command.",
    },
    {
      label: "Esc Clear or close",
      detail:
        "Clear transient state first, then close the top panel or go back one level. Esc should never imply confirm or playback start.",
    },
    {
      label: "Enter Search or confirm",
      detail:
        "Searches when the query changed, otherwise confirms the selected result or the focused picker option.",
    },
    {
      label: "/ details Title overview",
      detail:
        "Open the expanded overview panel for the selected title, including poster status, rating when available, and provider metadata gaps.",
    },
    {
      label: "↑↓ Navigate",
      detail:
        "Move through results, provider options, episodes, seasons, and command suggestions without leaving the shell.",
    },
    {
      label: "Type to filter pickers",
      detail:
        "Season, episode, provider, subtitle, and history flows should stay filterable instead of asking for raw values.",
    },
    {
      label: "Ctrl+W Delete previous word",
      detail:
        "Supported in the browse input and shell-hosted picker filters so terminal-native editing keeps working.",
    },
    {
      label: "Tab Destination mode",
      detail:
        "In browse, Tab jumps straight to the destination mode shown in the footer, like anime mode or series mode.",
    },
    {
      label: "Playback continuity",
      detail:
        "Replay, provider switch, history, diagnostics, and episode actions should stay reachable after playback returns.",
    },
    {
      label: "Disabled actions explain themselves",
      detail:
        "If a command is unavailable, the footer and command palette show the reason instead of silently ignoring the keypress.",
    },
  ];
}

export function buildAboutPanelLines({
  config,
  state,
}: {
  config: KitsuneConfig;
  state: SessionState;
}): readonly ShellPanelLine[] {
  return [
    {
      label: "Version",
      detail: "v0.1.0-beta.0",
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
      label: "Privacy",
      detail: "Diagnostics stay local unless you explicitly export or share them.",
    },
  ];
}

export function buildDiagnosticsPanelLines({
  state,
  recentEvents,
}: {
  state: SessionState;
  recentEvents: readonly DiagnosticEvent[];
}): readonly ShellPanelLine[] {
  const subtitleState = describeSubtitleState(state);
  const bufferingEvent = findRecentMpvEvent(recentEvents, "network-buffering");
  const streamStallEvent = findRecentMpvEvent(recentEvents, "stream-stalled");
  const seekStallEvent = findRecentMpvEvent(recentEvents, "seek-stalled");
  const ipcStallEvent = findRecentMpvEvent(recentEvents, "ipc-stalled");
  return [
    {
      label: "Mode and provider",
      detail: `${state.mode}  ·  ${state.provider}`,
    },
    {
      label: "View and playback",
      detail: `${state.view}  ·  ${state.playbackStatus}`,
    },
    {
      label: "Subtitle state",
      detail: subtitleState.label,
      tone: subtitleState.tone,
    },
    {
      label: "Selected subtitle URL",
      detail: state.stream?.subtitle ?? subtitleState.label,
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
        ? JSON.stringify(state.stream.subtitleEvidence)
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
      detail: state.stream?.url ?? "not resolved yet",
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
        ? `${event.message}  ·  ${JSON.stringify(event.context)}`
        : event.message,
    })),
  ];
}

function historyProgress(entry: HistoryEntry): string {
  if (entry.duration > 0) {
    return `${Math.round((entry.timestamp / entry.duration) * 100)}% watched`;
  }
  return "position saved";
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
    .map(([, entry]: [string, HistoryEntry]) => ({
      label:
        entry.type === "series"
          ? `${entry.title}  ·  S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}`
          : `${entry.title}  ·  movie`,
      detail: `${historyProgress(entry)}  ·  provider ${entry.provider}  ·  ${new Date(entry.watchedAt).toLocaleDateString()}`,
    }));
}

export function buildHistoryPickerOptions(
  historyEntries: ReadonlyArray<[string, HistoryEntry]>,
): readonly ShellPickerOption<string>[] {
  return sortHistoryEntries(historyEntries).map(([id, entry]: [string, HistoryEntry]) => ({
    value: id,
    label:
      entry.type === "series"
        ? `${entry.title}  ·  S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}`
        : `${entry.title}  ·  movie`,
    detail: `${historyProgress(entry)}  ·  provider ${entry.provider}  ·  ${new Date(entry.watchedAt).toLocaleDateString()}`,
  }));
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
    label: provider.id === currentProvider ? `${provider.name}  ·  current` : provider.name,
    detail: provider.description,
  }));
}
