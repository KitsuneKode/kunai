import { openListShell } from "@/app-shell/ink-shell";
import {
  buildPickerActionContext,
  chooseEpisodeFromOptions,
  chooseSeasonFromOptions,
  openAnimeEpisodePicker,
  openAnimeEpisodeListPicker,
} from "@/app-shell/workflows";
import { resolveEpisodeAvailability } from "@/app/playback-policy";
import type { Container } from "@/container";
import type { EpisodePickerOption } from "@/domain/types";
import { cyan, dim, yellow } from "@/menu";
import {
  type HistoryEntry,
  formatTimestamp,
  isFinished,
} from "@/services/persistence/HistoryStore";
import { fetchEpisodes, fetchSeriesData } from "@/tmdb";

export type EpisodeSelection = {
  season: number;
  episode: number;
  startAt?: number;
};

export type EpisodeSelectionResult = EpisodeSelection | null;

type SelectionOpts = {
  currentId: string;
  isAnime: boolean;
  animeEpisodeCount?: number;
  animeEpisodes?: readonly EpisodePickerOption[];
  flags: { season?: string; episode?: string };
  getHistoryEntry: () => Promise<HistoryEntry | null>;
  container?: Container;
};

type NextHistoryEpisodeArgs = {
  currentId: string;
  isAnime: boolean;
  history: HistoryEntry;
  animeEpisodeCount?: number;
  animeEpisodes?: readonly EpisodePickerOption[];
  loaders?: {
    loadSeasons: typeof fetchSeriesData;
    loadEpisodes: typeof fetchEpisodes;
  };
};

function createPickerActionContext(container: Container | undefined, taskLabel: string) {
  return container ? buildPickerActionContext({ container, taskLabel }) : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

async function pickAnimeEpisode(
  initialEpisode: number,
  episodes: readonly EpisodePickerOption[] | undefined,
  episodeCount: number | undefined,
  container?: Container,
): Promise<number | null> {
  const actionContext = createPickerActionContext(container, "Choose episode");
  if (episodes && episodes.length > 0) {
    return await openAnimeEpisodeListPicker(episodes, initialEpisode, actionContext, container);
  }
  if (!episodeCount || episodeCount < 1) {
    const action = await openListShell({
      title: "Episode metadata unavailable",
      subtitle:
        "This anime provider did not return an episode list for the selected title. Starting blindly at episode 1 is risky.",
      actionContext: createPickerActionContext(container, "Review episode metadata warning"),
      options: [
        {
          value: "start" as const,
          label: `Start episode ${initialEpisode}`,
          detail: "Continue anyway with the current fallback episode",
        },
        {
          value: "back" as const,
          label: "Back",
          detail: "Return without starting playback",
        },
      ],
    });

    return action === "start" ? initialEpisode : null;
  }
  return await openAnimeEpisodePicker(episodeCount, initialEpisode, actionContext, container);
}

async function pickEpisodeSelection(
  initSeason: number,
  initEpisode: number,
  opts: Pick<
    SelectionOpts,
    "currentId" | "isAnime" | "animeEpisodeCount" | "animeEpisodes" | "container"
  >,
): Promise<EpisodeSelectionResult> {
  if (!opts.isAnime) {
    const { seasons, episodes: initialEpisodes } = await fetchSeriesData(
      opts.currentId,
      initSeason,
    );
    const season = await chooseSeasonFromOptions(
      seasons,
      initSeason,
      createPickerActionContext(opts.container, "Choose season"),
      opts.container,
    );
    if (!season) return null;
    const episodes =
      season === initSeason ? initialEpisodes : await fetchEpisodes(opts.currentId, season);
    const episode = await chooseEpisodeFromOptions(
      episodes,
      season,
      initEpisode,
      createPickerActionContext(opts.container, "Choose episode"),
      opts.container,
      opts.currentId,
    );
    if (!episode) return null;
    return { season, episode: episode.number };
  }

  const episode = await pickAnimeEpisode(
    initEpisode,
    opts.animeEpisodes,
    opts.animeEpisodeCount,
    opts.container,
  );
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
  container?: Container;
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
  const resumeAt = formatTimestamp(history.timestamp);

  const nextEpisode = await resolveNextHistoryEpisode({
    currentId: opts.currentId,
    isAnime: opts.isAnime,
    history,
    animeEpisodeCount: opts.animeEpisodeCount,
    animeEpisodes: opts.animeEpisodes,
  });

  const choice = (await openListShell({
    title: "Where to start?",
    subtitle: opts.isAnime
      ? "Choose the starting episode"
      : "Choose the starting season and episode",
    actionContext: createPickerActionContext(opts.container, "Choose starting point"),
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
        label: nextEpisode
          ? `Next episode  S${nextEpisode.season}E${nextEpisode.episode}`
          : "Next episode unavailable",
        detail: nextEpisode
          ? "Advance to the next released episode"
          : "No later released episode is available yet",
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

  if (choice === "resume") {
    return {
      season: opts.isAnime ? 1 : history.season,
      episode: history.episode,
      startAt: history.timestamp,
    };
  }
  if (choice === "restart") {
    return { season: opts.isAnime ? 1 : history.season, episode: history.episode };
  }
  if (choice === "next") {
    if (!nextEpisode) {
      return null;
    }
    return nextEpisode;
  }

  return pickEpisodeSelection(history.season, history.episode, opts);
}

export async function resolveNextHistoryEpisode(
  args: NextHistoryEpisodeArgs,
): Promise<EpisodeSelection | null> {
  const loadSeriesData = args.loaders?.loadSeasons ?? fetchSeriesData;
  const loadEpisodes = args.loaders?.loadEpisodes ?? fetchEpisodes;
  const nextSelection = await resolveEpisodeAvailability({
    title: {
      id: args.currentId,
      type: "series",
      name: "Current title",
      episodeCount: args.animeEpisodeCount,
    },
    currentEpisode: {
      season: args.isAnime ? 1 : args.history.season,
      episode: args.history.episode,
    },
    isAnime: args.isAnime,
    animeEpisodeCount: args.animeEpisodeCount,
    animeEpisodes: args.animeEpisodes,
    loaders: {
      loadSeasons: async (titleId) => {
        const { seasons } = await loadSeriesData(titleId, args.history.season);
        return seasons;
      },
      loadEpisodes,
    },
  });

  return nextSelection.nextEpisode
    ? {
        season: nextSelection.nextEpisode.season,
        episode: nextSelection.nextEpisode.episode,
      }
    : null;
}

export function describeHistoryEntry(entry: HistoryEntry): string {
  const percent = entry.duration ? Math.round((entry.timestamp / entry.duration) * 100) : 0;
  const resumeAt = formatTimestamp(entry.timestamp);
  return isFinished(entry)
    ? `Last finished: ${cyan(`S${entry.season}E${entry.episode}`)}`
    : `Last watched: ${cyan(`S${entry.season}E${entry.episode}`)}  stopped at ${yellow(resumeAt)}  ${dim(`(${percent}%)`)}`;
}
