import { type HistoryEntry, formatTimestamp, isFinished } from "@/history";
import { cyan, dim, yellow } from "@/menu";
import { fetchEpisodes, fetchSeriesData } from "@/tmdb";
import { ANIME_PROVIDERS, PLAYWRIGHT_PROVIDERS, getProvider } from "@/providers";
import type { EpisodePickerOption } from "@/domain/types";
import {
  chooseEpisodeFromOptions,
  chooseSeasonFromOptions,
  openAnimeEpisodePicker,
  openAnimeEpisodeListPicker,
} from "@/app-shell/workflows";
import { openListShell } from "@/app-shell/ink-shell";

export type EpisodeSelection = {
  season: number;
  episode: number;
};

export type EpisodeSelectionResult = EpisodeSelection | null;

type SelectionOpts = {
  currentId: string;
  isAnime: boolean;
  animeEpisodeCount?: number;
  animeEpisodes?: readonly EpisodePickerOption[];
  flags: { season?: string; episode?: string };
  getHistoryEntry: () => Promise<HistoryEntry | null>;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

async function pickAnimeEpisode(
  initialEpisode: number,
  episodes: readonly EpisodePickerOption[] | undefined,
  episodeCount: number | undefined,
): Promise<number | null> {
  if (episodes && episodes.length > 0) {
    return await openAnimeEpisodeListPicker(episodes, initialEpisode);
  }
  if (!episodeCount || episodeCount < 1) return initialEpisode;
  return await openAnimeEpisodePicker(episodeCount, initialEpisode);
}

async function pickEpisodeSelection(
  initSeason: number,
  initEpisode: number,
  opts: Pick<SelectionOpts, "currentId" | "isAnime" | "animeEpisodeCount" | "animeEpisodes">,
): Promise<EpisodeSelectionResult> {
  if (!opts.isAnime) {
    const { seasons, episodes: initialEpisodes } = await fetchSeriesData(
      opts.currentId,
      initSeason,
    );
    const season = await chooseSeasonFromOptions(seasons, initSeason);
    if (!season) return null;
    const episodes =
      season === initSeason ? initialEpisodes : await fetchEpisodes(opts.currentId, season);
    const episode = await chooseEpisodeFromOptions(episodes, season, initEpisode);
    if (!episode) return null;
    return { season, episode: episode.number };
  }

  const episode = await pickAnimeEpisode(initEpisode, opts.animeEpisodes, opts.animeEpisodeCount);
  if (!episode) return null;
  return { season: 1, episode };
}

export async function chooseEpisodeFromMetadata(opts: {
  currentId: string;
  isAnime: boolean;
  currentSeason: number;
  currentEpisode: number;
  animeEpisodeCount?: number;
  animeEpisodes?: readonly EpisodePickerOption[];
}): Promise<EpisodeSelectionResult> {
  return pickEpisodeSelection(opts.currentSeason, opts.currentEpisode, opts);
}

export async function chooseStartingEpisode(opts: SelectionOpts): Promise<EpisodeSelectionResult> {
  if (opts.flags.season || opts.flags.episode) {
    return {
      season: opts.isAnime ? 1 : parsePositiveInt(opts.flags.season, 1),
      episode: parsePositiveInt(opts.flags.episode, 1),
    };
  }

  const history = await opts.getHistoryEntry();
  if (!history) {
    return pickEpisodeSelection(1, 1, opts);
  }

  const finished = isFinished(history);
  const nextEpisode = history.episode + 1;
  const resumeAt = formatTimestamp(history.timestamp);

  const choice = (await openListShell({
    title: "Where to start?",
    subtitle: opts.isAnime
      ? "Choose the starting episode"
      : "Choose the starting season and episode",
    options: [
      ...(!finished
        ? [
            {
              value: "resume" as const,
              label: `Resume S${history.season}E${history.episode}`,
              detail: `Continue from ${resumeAt}`,
            },
            {
              value: "restart" as const,
              label: `Restart S${history.season}E${history.episode}`,
              detail: "Start the current episode from the beginning",
            },
          ]
        : []),
      {
        value: "next" as const,
        label: `Next episode  S${history.season}E${nextEpisode}`,
        detail: "Advance to the next episode",
      },
      {
        value: "pick" as const,
        label: opts.isAnime ? "Pick episode…" : "Pick season & episode…",
        detail: "Choose manually from metadata",
      },
    ],
  })) as "resume" | "restart" | "next" | "pick" | null;

  // Esc should back out of the start picker, not silently launch playback.
  if (!choice) {
    return null;
  }

  if (choice === "resume" || choice === "restart") {
    return { season: opts.isAnime ? 1 : history.season, episode: history.episode };
  }
  if (choice === "next") {
    return { season: opts.isAnime ? 1 : history.season, episode: nextEpisode };
  }

  return pickEpisodeSelection(history.season, history.episode, opts);
}

export function describeHistoryEntry(entry: HistoryEntry): string {
  const percent = entry.duration ? Math.round((entry.timestamp / entry.duration) * 100) : 0;
  const resumeAt = formatTimestamp(entry.timestamp);
  return isFinished(entry)
    ? `Last finished: ${cyan(`S${entry.season}E${entry.episode}`)}`
    : `Last watched: ${cyan(`S${entry.season}E${entry.episode}`)}  stopped at ${yellow(resumeAt)}  ${dim(`(${percent}%)`)}`;
}

export function cycleProvider(currentProvider: string, isAnime: boolean): string {
  const pool = isAnime ? ANIME_PROVIDERS : PLAYWRIGHT_PROVIDERS;
  const currentIndex = pool.findIndex((provider) => provider.id === currentProvider);
  return (pool[(currentIndex + 1) % pool.length] ?? pool[0] ?? getProvider(currentProvider)).id;
}
