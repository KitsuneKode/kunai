import type { KitsuneConfig } from "@/config";
import type { Container } from "@/container";
import type { EpisodePickerOption } from "@/domain/types";
import {
  formatTimestamp,
  isFinished,
  type HistoryEntry,
  type HistoryStore,
} from "@/services/persistence/HistoryStore";
import { fetchEpisodes, fetchSeasons, type EpisodeInfo } from "@/tmdb";

import { resolveCommands } from "./commands";
import { openListShell, type ListShellActionContext } from "./ink-shell";
import { waitForRootPicker } from "./root-picker-bridge";
import type { ShellAction } from "./types";

type HistoryAction =
  | { type: "entry"; id: string; title: string }
  | { type: "clear-all" }
  | { type: "back" };

type ShellOption<T> = {
  value: T;
  label: string;
  detail?: string;
};

const SUBTITLE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "fzf", label: "Pick interactively" },
  { value: "none", label: "None" },
  { value: "ar", label: "Arabic" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "ja", label: "Japanese" },
] as const;

const ANIME_AUDIO_OPTIONS = [
  { value: "sub", label: "Sub", detail: "Original audio with subtitles" },
  { value: "dub", label: "Dub", detail: "Dubbed audio when available" },
] as const;

async function chooseOption<T>({
  title,
  subtitle,
  options,
  actionContext,
}: {
  title: string;
  subtitle: string;
  options: readonly ShellOption<T>[];
  actionContext?: ListShellActionContext;
}): Promise<T | null> {
  return openListShell({ title, subtitle, options, actionContext });
}

export async function chooseSeasonFromOptions(
  seasons: readonly number[],
  currentSeason: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  if (seasons.length === 0) return null;
  if (seasons.length === 1) return seasons[0] ?? currentSeason;

  if (container) {
    container.stateManager.dispatch({
      type: "OPEN_OVERLAY",
      overlay: {
        type: "season_picker",
        currentSeason,
        options: seasons.map((season) => ({
          value: String(season),
          label: season === currentSeason ? `Season ${season}  ·  current` : `Season ${season}`,
        })),
      },
    });
    const picked = await waitForRootPicker();
    return picked ? Number.parseInt(picked, 10) : null;
  }

  return chooseOption({
    title: "Choose season",
    subtitle: `Current season ${currentSeason}`,
    actionContext,
    options: seasons.map((season) => ({
      value: season,
      label: season === currentSeason ? `Season ${season}  ·  current` : `Season ${season}`,
    })),
  });
}

export async function chooseEpisodeFromOptions(
  episodes: readonly EpisodeInfo[],
  season: number,
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<EpisodeInfo | null> {
  if (episodes.length === 0) return null;

  if (container) {
    container.stateManager.dispatch({
      type: "OPEN_OVERLAY",
      overlay: {
        type: "episode_picker",
        season,
        options: episodes.map((episode) => ({
          value: String(episode.number),
          label:
            episode.number === currentEpisode
              ? `Episode ${episode.number}  ·  ${episode.name}  ·  current`
              : `Episode ${episode.number}  ·  ${episode.name}`,
          detail: `${episode.airDate || "unknown year"}${episode.overview ? `  ·  ${episode.overview}` : ""}`,
        })),
      },
    });
    const picked = await waitForRootPicker();
    if (!picked) return null;
    return episodes.find((episode) => String(episode.number) === picked) ?? null;
  }

  return chooseOption({
    title: "Choose episode",
    subtitle: `Season ${season}  ·  Current episode ${currentEpisode}`,
    actionContext,
    options: episodes.map((episode) => ({
      value: episode,
      label:
        episode.number === currentEpisode
          ? `Episode ${episode.number}  ·  ${episode.name}  ·  current`
          : `Episode ${episode.number}  ·  ${episode.name}`,
      detail: `${episode.airDate || "unknown year"}${episode.overview ? `  ·  ${episode.overview}` : ""}`,
    })),
  });
}

function formatHistoryLabel(entry: HistoryEntry): string {
  const progress = entry.duration
    ? `${Math.round((entry.timestamp / entry.duration) * 100)}%`
    : formatTimestamp(entry.timestamp);
  return entry.type === "series"
    ? `${entry.title}  ·  S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}  ·  ${progress}`
    : `${entry.title}  ·  movie  ·  ${progress}`;
}

function formatHistoryDetail(entry: HistoryEntry): string {
  const watched = new Date(entry.watchedAt).toLocaleDateString();
  return `${watched}${isFinished(entry) ? "  ·  finished" : ""}  ·  provider ${entry.provider}`;
}

function summarizeHeaderKeys(headers: Record<string, string> | undefined): string {
  const keys = Object.keys(headers ?? {});
  return keys.length > 0 ? keys.join(", ") : "none";
}

async function openHistoryShell(
  historyStore: HistoryStore,
  actionContext?: ListShellActionContext,
): Promise<void> {
  while (true) {
    const entries = Object.entries(await historyStore.getAll()).sort(
      (a, b) =>
        (new Date(b[1].watchedAt).getTime() || 0) - (new Date(a[1].watchedAt).getTime() || 0),
    );

    const options: ShellOption<HistoryAction>[] = [
      ...entries.map(([id, entry]) => ({
        value: { type: "entry" as const, id, title: entry.title },
        label: formatHistoryLabel(entry),
        detail: formatHistoryDetail(entry),
      })),
      ...(entries.length > 0
        ? [
            {
              value: { type: "clear-all" as const },
              label: "Clear all history",
              detail: "Remove every saved playback position",
            },
          ]
        : []),
      { value: { type: "back" as const }, label: "Back" },
    ];

    const picked = await chooseOption({
      title: "History",
      subtitle:
        entries.length > 0
          ? "Select an entry to remove it, or clear the full history"
          : "No watch history yet",
      actionContext,
      options,
    });

    if (!picked || picked.type === "back") return;

    if (picked.type === "clear-all") {
      const confirm = await chooseOption({
        title: "Clear all history?",
        subtitle: "This removes every saved playback position",
        actionContext,
        options: [
          { value: true, label: "Yes, clear all history" },
          { value: false, label: "Cancel" },
        ],
      });
      if (confirm) await historyStore.clear();
      continue;
    }

    const confirm = await chooseOption({
      title: `Remove ${picked.title}?`,
      subtitle: "This deletes the saved position for this title",
      actionContext,
      options: [
        { value: true, label: "Remove entry" },
        { value: false, label: "Keep entry" },
      ],
    });
    if (confirm) await historyStore.delete(picked.id);
  }
}

async function openStaticInfoShell({
  title,
  subtitle,
  lines,
}: {
  title: string;
  subtitle: string;
  lines: readonly { label: string; detail?: string }[];
}): Promise<void> {
  await chooseOption({
    title,
    subtitle,
    options: [
      ...lines.map((line, index) => ({
        value: index,
        label: line.label,
        detail: line.detail,
      })),
      { value: -1, label: "Back" },
    ],
  });
}

export function buildPickerActionContext({
  container,
  taskLabel,
  footerMode = container.config.getRaw().footerHints,
  allowed = ["settings", "history", "diagnostics", "help", "about", "quit"],
}: {
  container: Container;
  taskLabel: string;
  footerMode?: "detailed" | "minimal";
  allowed?: readonly import("./commands").AppCommandId[];
}): ListShellActionContext {
  return {
    taskLabel,
    footerMode,
    commands: resolveCommands(container.stateManager.getState(), allowed),
    onAction: (action) => handleShellAction({ action, container }),
  };
}

export async function applySettingsToRuntime({
  container,
  next,
  previous,
}: {
  container: Container;
  next: KitsuneConfig;
  previous?: KitsuneConfig;
}): Promise<void> {
  const { stateManager, config } = container;
  const before = previous ?? config.getRaw();

  await config.update(next);
  await config.save();

  const state = stateManager.getState();
  stateManager.dispatch({
    type: "SET_DEFAULT_PROVIDER",
    mode: "series",
    provider: next.provider,
  });
  stateManager.dispatch({
    type: "SET_DEFAULT_PROVIDER",
    mode: "anime",
    provider: next.animeProvider,
  });
  stateManager.dispatch({ type: "SET_SUB_LANG", subLang: next.subLang });
  stateManager.dispatch({ type: "SET_ANIME_LANG", animeLang: next.animeLang });

  const currentProvider =
    state.mode === "anime" ? state.defaultProviders.anime : state.defaultProviders.series;
  const nextDefault = state.mode === "anime" ? next.animeProvider : next.provider;
  if (state.provider === currentProvider && state.provider !== nextDefault) {
    stateManager.dispatch({
      type: "SET_PROVIDER",
      provider: nextDefault,
    });
  }

  if (state.mode === before.defaultMode && state.mode !== next.defaultMode) {
    stateManager.dispatch({
      type: "SET_MODE",
      mode: next.defaultMode,
      provider: next.defaultMode === "anime" ? next.animeProvider : next.provider,
    });
  }
}

export async function handleShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<"handled" | "quit" | "unhandled"> {
  const { providerRegistry, stateManager, config, diagnosticsStore, historyStore, cacheStore } =
    container;

  const withOverlay = async <T>(
    overlay: import("@/domain/session/SessionState").OverlayState,
    run: () => Promise<T>,
  ): Promise<T> => {
    stateManager.dispatch({ type: "OPEN_OVERLAY", overlay });
    try {
      return await run();
    } finally {
      stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    }
  };

  if (action === "quit") {
    return "quit";
  }

  if (action === "history") {
    await withOverlay({ type: "history" }, () =>
      openHistoryShell(
        historyStore,
        buildPickerActionContext({ container, taskLabel: "Manage history" }),
      ),
    );
    return "handled";
  }

  if (action === "help") {
    await withOverlay({ type: "help" }, () =>
      openStaticInfoShell({
        title: "Help",
        subtitle: "Global commands, editing, filtering, and playback navigation",
        lines: [
          {
            label: "/ Command bar",
            detail:
              "Open global actions from anywhere in the shell. Use Tab to autocomplete, ↑↓ to choose, and Enter to run the highlighted command.",
          },
          {
            label: "Esc Clear or close",
            detail:
              "Clear the current transient state first, then close the top overlay or go back one level. Esc should never imply confirm.",
          },
          {
            label: "Enter Search or confirm",
            detail:
              "Searches when the query changed, otherwise confirms the selected result or picker entry.",
          },
          {
            label: "↑↓ Navigate",
            detail: "Move through visible results, episodes, season rows, and command suggestions.",
          },
          {
            label: "Type to filter pickers",
            detail:
              "Season, episode, provider, subtitle, history, and settings pickers all support inline filtering.",
          },
          {
            label: "Ctrl+W Delete previous word",
            detail:
              "Supported in the browse input and picker filters so terminal-native editing keeps working.",
          },
          {
            label: "Tab Switch destination mode",
            detail:
              "In browse, Tab jumps directly into the destination mode shown in the footer, like anime mode or series mode.",
          },
          {
            label: "Playback actions",
            detail:
              "Replay, episode picker, provider switch, history, diagnostics, and next/previous actions stay reachable after playback ends.",
          },
          {
            label: "Why commands are disabled",
            detail:
              "If an action is unavailable, the footer and command palette show the reason instead of silently ignoring input.",
          },
        ],
      }),
    );
    return "handled";
  }

  if (action === "about") {
    await withOverlay({ type: "about" }, () =>
      openStaticInfoShell({
        title: "About",
        subtitle: "Kunai beta",
        lines: [
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
            detail: `${stateManager.getState().mode}  ·  Provider ${stateManager.getState().provider}`,
          },
          {
            label: "Default startup mode",
            detail: `${config.getRaw().defaultMode}  ·  Series ${config.getRaw().provider}  ·  Anime ${config.getRaw().animeProvider}`,
          },
          {
            label: "Privacy",
            detail: "Diagnostics stay local unless you explicitly export or share them.",
          },
        ],
      }),
    );
    return "handled";
  }

  if (action === "diagnostics") {
    const state = stateManager.getState();
    const recentEvents = diagnosticsStore.getRecent(6);
    await withOverlay({ type: "diagnostics" }, () =>
      openStaticInfoShell({
        title: "Diagnostics",
        subtitle: "Current shell state snapshot",
        lines: [
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
            detail: state.stream?.subtitle
              ? `resolved  ·  ${state.stream.subtitle}`
              : "not found or disabled",
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
        ],
      }),
    );
    return "handled";
  }

  if (action === "provider") {
    const state = stateManager.getState();
    const picked = await withOverlay(
      {
        type: "provider_picker",
        currentProvider: state.provider,
        isAnime: state.mode === "anime",
      },
      () =>
        openProviderPicker({
          currentProvider: state.provider,
          providers: providerRegistry
            .getAll()
            .map((p) => p.metadata)
            .filter((p) => p.isAnimeProvider === (state.mode === "anime")),
          actionContext: buildPickerActionContext({
            container,
            taskLabel: "Choose provider",
            allowed: ["settings", "history", "diagnostics", "help", "about", "quit"],
          }),
        }),
    );

    if (picked && picked !== state.provider) {
      stateManager.dispatch({
        type: "SET_PROVIDER",
        provider: picked,
      });
    }
    return "handled";
  }

  if (action === "settings") {
    const next = await withOverlay({ type: "settings" }, () =>
      openSettingsShell({
        container,
        current: config.getRaw(),
        historyStore: container.historyStore,
        actionContext: buildPickerActionContext({
          container,
          taskLabel: "Adjust settings",
          allowed: ["history", "diagnostics", "help", "about", "quit"],
        }),
        seriesProviders: providerRegistry
          .getAll()
          .map((p) => p.metadata)
          .filter((p) => !p.isAnimeProvider),
        animeProviders: providerRegistry
          .getAll()
          .map((p) => p.metadata)
          .filter((p) => p.isAnimeProvider),
      }),
    );

    if (next) {
      await applySettingsToRuntime({ container, next, previous: config.getRaw() });
    }

    return "handled";
  }

  if (action === "clear-cache") {
    const confirm = await chooseOption({
      title: "Clear stream cache?",
      subtitle: "This will remove all cached stream URLs. Next play will require fresh scraping.",
      options: [
        { value: true, label: "Yes, clear cache" },
        { value: false, label: "Cancel" },
      ],
    });
    if (confirm) {
      await cacheStore.clear();
      diagnosticsStore.record({ category: "cache", message: "Stream cache cleared" });
    }
    return "handled";
  }

  if (action === "clear-history") {
    const confirm = await chooseOption({
      title: "Clear watch history?",
      subtitle: "This will remove all saved playback positions and progress.",
      options: [
        { value: true, label: "Yes, clear history" },
        { value: false, label: "Cancel" },
      ],
    });
    if (confirm) {
      await historyStore.clear();
      diagnosticsStore.record({ category: "session", message: "Watch history cleared" });
    }
    return "handled";
  }

  return "unhandled";
}

export async function openProviderPicker({
  currentProvider,
  providers,
  actionContext,
}: {
  currentProvider: string;
  providers: readonly import("@/domain/types").ProviderMetadata[];
  actionContext?: ListShellActionContext;
}): Promise<string | null> {
  return chooseOption({
    title: "Choose provider",
    subtitle: `Current provider ${currentProvider}`,
    actionContext,
    options: providers.map((provider) => ({
      value: provider.id,
      label: provider.id === currentProvider ? `${provider.name}  ·  current` : provider.name,
      detail: provider.description,
    })),
  });
}

export async function openSubtitlePicker(
  entries: ReadonlyArray<{
    url: string;
    display?: string;
    language?: string;
    release?: string;
    sourceKind?: "embedded" | "external";
    sourceName?: string;
  }>,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<string | null> {
  const describeSubtitleEntry = (entry: {
    language?: string;
    release?: string;
    sourceKind?: "embedded" | "external";
    sourceName?: string;
  }): string => {
    const parts = [entry.language ?? "unknown"];
    if (entry.sourceKind === "embedded") {
      parts.push("built-in");
    } else if (entry.sourceKind === "external") {
      parts.push("external");
    }
    if (entry.sourceName) {
      parts.push(entry.sourceName);
    }
    if (entry.release) {
      parts.push(entry.release);
    }
    return parts.join("  ·  ");
  };

  if (container) {
    container.stateManager.dispatch({
      type: "OPEN_OVERLAY",
      overlay: {
        type: "subtitle_picker",
        options: entries.map((entry) => ({
          value: entry.url,
          label: entry.display ?? entry.language ?? "Unknown track",
          detail: describeSubtitleEntry(entry),
        })),
      },
    });
    return await waitForRootPicker();
  }

  return chooseOption({
    title: "Choose subtitles",
    subtitle: `${entries.length} tracks available`,
    actionContext,
    options: entries.map((entry) => ({
      value: entry.url,
      label: entry.display ?? entry.language ?? "Unknown track",
      detail: describeSubtitleEntry(entry),
    })),
  });
}

export async function openSeasonPicker(
  tmdbId: string,
  currentSeason: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  const seasons = await fetchSeasons(tmdbId);
  return chooseSeasonFromOptions(seasons, currentSeason, actionContext, container);
}

export async function openEpisodePicker(
  tmdbId: string,
  season: number,
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<EpisodeInfo | null> {
  const episodes = await fetchEpisodes(tmdbId, season);
  return chooseEpisodeFromOptions(episodes, season, currentEpisode, actionContext, container);
}

export async function openAnimeEpisodePicker(
  count: number,
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  const episodes = Array.from({ length: count }, (_, index) => index + 1);
  if (container) {
    container.stateManager.dispatch({
      type: "OPEN_OVERLAY",
      overlay: {
        type: "episode_picker",
        season: 1,
        options: episodes.map((episode) => ({
          value: String(episode),
          label:
            episode === currentEpisode ? `Episode ${episode}  ·  current` : `Episode ${episode}`,
        })),
      },
    });
    const picked = await waitForRootPicker();
    return picked ? Number.parseInt(picked, 10) : null;
  }
  return chooseOption({
    title: "Choose episode",
    subtitle: `${count} episodes available`,
    actionContext,
    options: episodes.map((episode) => ({
      value: episode,
      label: episode === currentEpisode ? `Episode ${episode}  ·  current` : `Episode ${episode}`,
    })),
  });
}

export async function openAnimeEpisodeListPicker(
  episodes: readonly EpisodePickerOption[],
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  if (episodes.length === 0) return null;

  if (container) {
    container.stateManager.dispatch({
      type: "OPEN_OVERLAY",
      overlay: {
        type: "episode_picker",
        season: 1,
        options: episodes.map((episode) => ({
          value: String(episode.index),
          label: episode.index === currentEpisode ? `${episode.label}  ·  current` : episode.label,
          detail: episode.detail,
        })),
      },
    });
    const picked = await waitForRootPicker();
    return picked ? Number.parseInt(picked, 10) : null;
  }

  return chooseOption({
    title: "Choose episode",
    subtitle: `${episodes.length} episodes available`,
    actionContext,
    options: episodes.map((episode) => ({
      value: episode.index,
      label: episode.index === currentEpisode ? `${episode.label}  ·  current` : episode.label,
      detail: episode.detail,
    })),
  });
}

function configSummary(config: KitsuneConfig): string {
  return `default ${config.defaultMode}  ·  provider ${config.provider}  ·  anime ${config.animeProvider}  ·  footer ${config.footerHints}`;
}

export async function openSettingsShell({
  container,
  current,
  historyStore,
  actionContext,
  seriesProviders,
  animeProviders,
}: {
  container?: Container;
  current: KitsuneConfig;
  historyStore?: HistoryStore;
  actionContext?: ListShellActionContext;
  seriesProviders: readonly import("@/domain/types").ProviderMetadata[];
  animeProviders: readonly import("@/domain/types").ProviderMetadata[];
}): Promise<KitsuneConfig | null> {
  let next = { ...current };
  let changed = false;

  while (true) {
    const action = await chooseOption({
      title: "Settings",
      subtitle: configSummary(next),
      actionContext,
      options: [
        {
          value: "defaultMode" as const,
          label: `Default startup mode  ·  ${next.defaultMode}`,
          detail: "Series or anime when the app launches",
        },
        {
          value: "provider" as const,
          label: `Default provider  ·  ${next.provider}`,
          detail: "Movies and series provider",
        },
        {
          value: "animeProvider" as const,
          label: `Anime provider  ·  ${next.animeProvider}`,
          detail: "Default anime source",
        },
        {
          value: "subLang" as const,
          label: `Subtitles  ·  ${next.subLang}`,
          detail: "Preferred subtitle behavior",
        },
        {
          value: "animeLang" as const,
          label: `Anime audio  ·  ${next.animeLang}`,
          detail: "Sub or dub preference",
        },
        {
          value: "headless" as const,
          label: `Browser mode  ·  ${next.headless ? "headless" : "visible"}`,
          detail: "Playwright browser visibility",
        },
        {
          value: "showMemory" as const,
          label: `Memory line  ·  ${next.showMemory ? "shown" : "hidden"}`,
          detail: "Show memory usage in playback shell",
        },
        {
          value: "autoNext" as const,
          label: `Autoplay next  ·  ${next.autoNext ? "on" : "off"}`,
          detail:
            "Close mpv on episode EOF, then continue through the next available released episode automatically",
        },
        {
          value: "skipRecap" as const,
          label: `Skip recaps  ·  ${next.skipRecap ? "on" : "off"}`,
          detail: "Auto-skip recap segments when IntroDB timing exists",
        },
        {
          value: "skipIntro" as const,
          label: `Skip intros  ·  ${next.skipIntro ? "on" : "off"}`,
          detail: "Auto-skip intro segments when IntroDB timing exists",
        },
        {
          value: "skipPreview" as const,
          label: `Skip previews  ·  ${next.skipPreview ? "on" : "off"}`,
          detail: "Auto-skip preview segments when IntroDB timing exists",
        },
        {
          value: "footerHints" as const,
          label: `Footer hints  ·  ${next.footerHints}`,
          detail: "Detailed keeps a two-line footer, minimal keeps only the task line",
        },
        {
          value: "history" as const,
          label: "Manage history",
          detail: "Review and remove saved positions",
        },
        {
          value: "clearCache" as const,
          label: "Clear stream cache",
          detail: "Wipe the local SQLite stream cache",
        },
        {
          value: "clearHistory" as const,
          label: "Clear watch history",
          detail: "Reset all watch progress and history",
        },
        { value: "done" as const, label: changed ? "Save and close" : "Close" },
      ],
    });

    if (!action) {
      return null;
    }

    if (action === "done") {
      return changed ? next : null;
    }

    if (action === "history") {
      if (historyStore) await openHistoryShell(historyStore, actionContext);
      continue;
    }

    if (action === "clearCache") {
      if (container) await handleShellAction({ action: "clear-cache", container });
      continue;
    }

    if (action === "clearHistory") {
      if (container) await handleShellAction({ action: "clear-history", container });
      continue;
    }

    if (action === "provider") {
      const picked = await chooseOption({
        title: "Default provider",
        subtitle: `Current ${next.provider}`,
        actionContext,
        options: seriesProviders.map((provider) => ({
          value: provider.id,
          label: provider.id === next.provider ? `${provider.name}  ·  current` : provider.name,
          detail: provider.description,
        })),
      });
      if (picked && picked !== next.provider) {
        next.provider = picked;
        changed = true;
      }
      continue;
    }

    if (action === "defaultMode") {
      const picked = await chooseOption({
        title: "Default startup mode",
        subtitle: `Current ${next.defaultMode}`,
        actionContext,
        options: [
          {
            value: "series" as const,
            label: next.defaultMode === "series" ? "Series mode  ·  current" : "Series mode",
            detail: "Browse movies and TV on launch",
          },
          {
            value: "anime" as const,
            label: next.defaultMode === "anime" ? "Anime mode  ·  current" : "Anime mode",
            detail: "Browse anime on launch",
          },
        ],
      });
      if (picked && picked !== next.defaultMode) {
        next.defaultMode = picked;
        changed = true;
      }
      continue;
    }

    if (action === "animeProvider") {
      const picked = await chooseOption({
        title: "Anime provider",
        subtitle: `Current ${next.animeProvider}`,
        actionContext,
        options: animeProviders.map((provider) => ({
          value: provider.id,
          label:
            provider.id === next.animeProvider ? `${provider.name}  ·  current` : provider.name,
          detail: provider.description,
        })),
      });
      if (picked && picked !== next.animeProvider) {
        next.animeProvider = picked;
        changed = true;
      }
      continue;
    }

    if (action === "subLang") {
      const picked = await chooseOption({
        title: "Subtitle preference",
        subtitle: `Current ${next.subLang}`,
        actionContext,
        options: SUBTITLE_OPTIONS.map((option) => ({
          value: option.value,
          label: option.value === next.subLang ? `${option.label}  ·  current` : option.label,
        })),
      });
      if (picked && picked !== next.subLang) {
        next.subLang = picked;
        changed = true;
      }
      continue;
    }

    if (action === "animeLang") {
      const picked = await chooseOption({
        title: "Anime audio",
        subtitle: `Current ${next.animeLang}`,
        actionContext,
        options: ANIME_AUDIO_OPTIONS.map((option) => ({
          value: option.value,
          label: option.value === next.animeLang ? `${option.label}  ·  current` : option.label,
          detail: option.detail,
        })),
      });
      if (picked && picked !== next.animeLang) {
        next.animeLang = picked;
        changed = true;
      }
      continue;
    }

    if (action === "headless") {
      next.headless = !next.headless;
      changed = true;
      continue;
    }

    if (action === "showMemory") {
      next.showMemory = !next.showMemory;
      changed = true;
      continue;
    }

    if (action === "autoNext") {
      next.autoNext = !next.autoNext;
      changed = true;
      continue;
    }

    if (action === "skipRecap") {
      next.skipRecap = !next.skipRecap;
      changed = true;
      continue;
    }

    if (action === "skipIntro") {
      next.skipIntro = !next.skipIntro;
      changed = true;
      continue;
    }

    if (action === "skipPreview") {
      next.skipPreview = !next.skipPreview;
      changed = true;
      continue;
    }

    if (action === "footerHints") {
      const picked = await chooseOption({
        title: "Footer hint density",
        subtitle: `Current ${next.footerHints}`,
        actionContext,
        options: [
          {
            value: "detailed" as const,
            label: next.footerHints === "detailed" ? "Detailed  ·  current" : "Detailed",
            detail: "Show the current task plus a second line of active shortcuts",
          },
          {
            value: "minimal" as const,
            label: next.footerHints === "minimal" ? "Minimal  ·  current" : "Minimal",
            detail: "Keep the current task visible and trim the shortcut line down",
          },
        ],
      });
      if (picked && picked !== next.footerHints) {
        next.footerHints = picked;
        changed = true;
      }
    }
  }
}
