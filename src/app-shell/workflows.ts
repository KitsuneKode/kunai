import { clearAllHistory, clearEntry, getAllHistory, isFinished, formatTimestamp } from "@/history";
import type { KitsuneConfig } from "@/config";
import { ANIME_PROVIDERS, PLAYWRIGHT_PROVIDERS } from "@/providers";
import { fetchEpisodes, fetchSeasons, type EpisodeInfo } from "@/tmdb";
import type { EpisodePickerOption } from "@/domain/types";
import type { Container } from "@/container";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import type { ShellAction } from "./types";

import { openListShell } from "./ink-shell";

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
}: {
  title: string;
  subtitle: string;
  options: readonly ShellOption<T>[];
}): Promise<T | null> {
  return openListShell({ title, subtitle, options });
}

export async function chooseSeasonFromOptions(
  seasons: readonly number[],
  currentSeason: number,
): Promise<number | null> {
  if (seasons.length === 0) return null;
  if (seasons.length === 1) return seasons[0] ?? currentSeason;

  return chooseOption({
    title: "Choose season",
    subtitle: `Current season ${currentSeason}`,
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
): Promise<EpisodeInfo | null> {
  if (episodes.length === 0) return null;

  return chooseOption({
    title: "Choose episode",
    subtitle: `Season ${season}  ·  Current episode ${currentEpisode}`,
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

async function openHistoryShell(): Promise<void> {
  while (true) {
    const entries = Object.entries(await getAllHistory()).sort(
      (a, b) => new Date(b[1].watchedAt).getTime() - new Date(a[1].watchedAt).getTime(),
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
      options,
    });

    if (!picked || picked.type === "back") return;

    if (picked.type === "clear-all") {
      const confirm = await chooseOption({
        title: "Clear all history?",
        subtitle: "This removes every saved playback position",
        options: [
          { value: true, label: "Yes, clear all history" },
          { value: false, label: "Cancel" },
        ],
      });
      if (confirm) await clearAllHistory();
      continue;
    }

    const confirm = await chooseOption({
      title: `Remove ${picked.title}?`,
      subtitle: "This deletes the saved position for this title",
      options: [
        { value: true, label: "Remove entry" },
        { value: false, label: "Keep entry" },
      ],
    });
    if (confirm) await clearEntry(picked.id);
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

export async function handleShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<"handled" | "quit" | "unhandled"> {
  const { stateManager, config } = container;

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
    await withOverlay({ type: "history" }, () => openHistoryShell());
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
        subtitle: "KitsuneSnipe beta",
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
            label: "Search state",
            detail: `${state.searchState}  ·  ${state.searchResults.length} results`,
          },
          {
            label: "Memory",
            detail: `RSS ${(process.memoryUsage().rss / 1_048_576).toFixed(1)} MB`,
          },
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
          isAnime: state.mode === "anime",
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
    const current = config.getRaw();
    const next = await withOverlay({ type: "settings" }, () => openSettingsShell(current));

    if (next) {
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
    }

    return "handled";
  }

  return "unhandled";
}

export async function openProviderPicker({
  currentProvider,
  isAnime,
}: {
  currentProvider: string;
  isAnime: boolean;
}): Promise<string | null> {
  const pool = isAnime ? ANIME_PROVIDERS : PLAYWRIGHT_PROVIDERS;
  return chooseOption({
    title: "Choose provider",
    subtitle: `Current provider ${currentProvider}`,
    options: pool.map((provider) => ({
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
  }>,
): Promise<string | null> {
  return chooseOption({
    title: "Choose subtitles",
    subtitle: `${entries.length} tracks available`,
    options: entries.map((entry) => ({
      value: entry.url,
      label: entry.display ?? entry.language ?? "Unknown track",
      detail: `${entry.language ?? "unknown"}${entry.release ? `  ·  ${entry.release}` : ""}`,
    })),
  });
}

export async function openSeasonPicker(
  tmdbId: string,
  currentSeason: number,
): Promise<number | null> {
  const seasons = await fetchSeasons(tmdbId);
  return chooseSeasonFromOptions(seasons, currentSeason);
}

export async function openEpisodePicker(
  tmdbId: string,
  season: number,
  currentEpisode: number,
): Promise<EpisodeInfo | null> {
  const episodes = await fetchEpisodes(tmdbId, season);
  return chooseEpisodeFromOptions(episodes, season, currentEpisode);
}

export async function openAnimeEpisodePicker(
  count: number,
  currentEpisode: number,
): Promise<number | null> {
  const episodes = Array.from({ length: count }, (_, index) => index + 1);
  return chooseOption({
    title: "Choose episode",
    subtitle: `${count} episodes available`,
    options: episodes.map((episode) => ({
      value: episode,
      label: episode === currentEpisode ? `Episode ${episode}  ·  current` : `Episode ${episode}`,
    })),
  });
}

export async function openAnimeEpisodeListPicker(
  episodes: readonly EpisodePickerOption[],
  currentEpisode: number,
): Promise<number | null> {
  if (episodes.length === 0) return null;

  return chooseOption({
    title: "Choose episode",
    subtitle: `${episodes.length} episodes available`,
    options: episodes.map((episode) => ({
      value: episode.index,
      label: episode.index === currentEpisode ? `${episode.label}  ·  current` : episode.label,
      detail: episode.detail,
    })),
  });
}

function configSummary(config: KitsuneConfig): string {
  return `provider ${config.provider}  ·  anime ${config.animeProvider}  ·  subs ${config.subLang}`;
}

export async function openSettingsShell(current: KitsuneConfig): Promise<KitsuneConfig | null> {
  let next = { ...current };
  let changed = false;

  while (true) {
    const action = await chooseOption({
      title: "Settings",
      subtitle: configSummary(next),
      options: [
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
          label: `Auto next  ·  ${next.autoNext ? "on" : "off"}`,
          detail: "Advance after episode EOF",
        },
        {
          value: "history" as const,
          label: "Manage history",
          detail: "Review and remove saved positions",
        },
        { value: "done" as const, label: changed ? "Save and close" : "Close" },
      ],
    });

    if (!action || action === "done") {
      return changed ? next : null;
    }

    if (action === "history") {
      await openHistoryShell();
      continue;
    }

    if (action === "provider") {
      const picked = await chooseOption({
        title: "Default provider",
        subtitle: `Current ${next.provider}`,
        options: PLAYWRIGHT_PROVIDERS.map((provider) => ({
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

    if (action === "animeProvider") {
      const picked = await chooseOption({
        title: "Anime provider",
        subtitle: `Current ${next.animeProvider}`,
        options: ANIME_PROVIDERS.map((provider) => ({
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
    }
  }
}
