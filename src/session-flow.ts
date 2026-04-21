import { type HistoryEntry, formatTimestamp, isFinished } from "@/history";
import { cyan, dim, yellow } from "@/menu";
import { fetchEpisodes, fetchSeriesData } from "@/tmdb";
import { ANIME_PROVIDERS, PLAYWRIGHT_PROVIDERS, getProvider } from "@/providers";
import type { ApiSearchResult } from "@/providers";
import {
  chooseEpisodeFromOptions,
  chooseSeasonFromOptions,
  openAnimeEpisodePicker,
  openEpisodePicker,
  openSeasonPicker,
} from "@/app-shell/workflows";
import { openListShell } from "@/app-shell/ink-shell";

export type EpisodeSelection = {
  season: number;
  episode: number;
};

type SelectionOpts = {
  currentId: string;
  isAnime: boolean;
  apiPicked: ApiSearchResult | null;
  flags: { season?: string; episode?: string };
  getHistoryEntry: () => Promise<HistoryEntry | null>;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

async function pickAnimeEpisode(
  initialEpisode: number,
  apiPicked: ApiSearchResult | null,
): Promise<number> {
  const epCount = apiPicked?.epCount;
  if (!epCount || epCount < 1) return initialEpisode;
  return (await openAnimeEpisodePicker(epCount, initialEpisode)) ?? initialEpisode;
}

async function pickEpisodeSelection(
  initSeason: number,
  initEpisode: number,
  opts: Pick<SelectionOpts, "currentId" | "isAnime" | "apiPicked">,
): Promise<EpisodeSelection> {
  if (!opts.isAnime) {
    const { seasons, episodes: initialEpisodes } = await fetchSeriesData(opts.currentId, initSeason);
    const season = (await chooseSeasonFromOptions(seasons, initSeason)) ?? initSeason;
    const episodes =
      season === initSeason ? initialEpisodes : await fetchEpisodes(opts.currentId, season);
    const episode = await chooseEpisodeFromOptions(episodes, season, initEpisode);
    return { season, episode: episode?.number ?? initEpisode };
  }

  const episode = await pickAnimeEpisode(initEpisode, opts.apiPicked);
  return { season: 1, episode };
}

export async function chooseStartingEpisode(opts: SelectionOpts): Promise<EpisodeSelection> {
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

  if (!choice || choice === "resume" || choice === "restart") {
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
