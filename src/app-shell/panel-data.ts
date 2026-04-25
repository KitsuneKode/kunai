import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import type { DiagnosticEvent } from "@/services/diagnostics/DiagnosticsStore";
import type { SessionState } from "@/domain/session/SessionState";
import type { ProviderMetadata } from "@/domain/types";

import type { ShellPanelLine, ShellPickerOption } from "./types";

function summarizeHeaderKeys(headers: Record<string, string> | undefined): string {
  const keys = Object.keys(headers ?? {});
  return keys.length > 0 ? keys.join(", ") : "none";
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
      detail: state.stream?.subtitle ? "resolved" : "not found or disabled",
      tone: state.stream?.subtitle ? "success" : "warning",
    },
    {
      label: "Selected subtitle URL",
      detail: state.stream?.subtitle ?? "not found or disabled",
    },
    {
      label: "Subtitle tracks",
      detail: String(state.stream?.subtitleList?.length ?? 0),
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

export function buildHistoryPanelLines(
  historyEntries: ReadonlyArray<[string, HistoryEntry]>,
): readonly ShellPanelLine[] {
  if (historyEntries.length === 0) {
    return [
      {
        label: "No watch history yet",
        detail:
          "Playback positions will appear here after you watch something long enough to resume.",
      },
    ];
  }

  return [...historyEntries]
    .sort(
      (a: [string, HistoryEntry], b: [string, HistoryEntry]) =>
        new Date(b[1].watchedAt).getTime() - new Date(a[1].watchedAt).getTime(),
    )
    .slice(0, 10)
    .map(([, entry]: [string, HistoryEntry]) => ({
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
