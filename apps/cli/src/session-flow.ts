import { openListShell } from "@/app-shell/ink-shell";
import { chooseEpisodeFromOptions, chooseSeasonFromOptions } from "@/app-shell/pickers";
import {
  buildPickerActionContext,
  openAnimeEpisodePicker,
  openAnimeEpisodeListPicker,
  openProviderPicker,
} from "@/app-shell/workflows";
import { resolveEpisodeAvailability } from "@/app/playback-policy";
import { applyUserProviderSwitch } from "@/app/playback-provider-switch";
import type { Container } from "@/container";
import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import type { EpisodePickerOption } from "@/domain/types";
import { cyan, dim, yellow } from "@/menu";
import {
  type HistoryEntry,
  formatTimestamp,
  isFinished,
} from "@/services/persistence/HistoryStore";
import { fetchEpisodes, fetchSeriesData, type EpisodeInfo as TmdbEpisodeInfo } from "@/tmdb";

export type EpisodeSelection = {
  season: number;
  episode: number;
  startAt?: number;
  suppressResumePrompt?: boolean;
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

export type StartingEpisodeChoice = "resume" | "restart" | "next" | "pick";
export type StartingEpisodePickerChoice = StartingEpisodeChoice | "switch-provider";

export function resolveStartingEpisodeChoice(args: {
  choice: StartingEpisodeChoice;
  isAnime: boolean;
  history: HistoryEntry;
  nextEpisode: EpisodeSelection | null;
}): EpisodeSelection | null {
  const historyEpisode = {
    season: args.isAnime ? 1 : args.history.season,
    episode: args.history.episode,
  };

  if (args.choice === "resume") {
    return {
      ...historyEpisode,
      startAt: args.history.timestamp,
      suppressResumePrompt: true,
    };
  }
  if (args.choice === "restart") {
    return {
      ...historyEpisode,
      startAt: args.history.timestamp,
    };
  }
  if (args.choice === "next") {
    return args.nextEpisode;
  }

  return null;
}

export type MovieStartingChoice = "resume" | "restart";

/**
 * Pure resolution of a movie starting-point choice into a playback selection.
 * Movies have no season/episode axis, so the internal episode is always {1,1}.
 * `resume` seeks directly to the saved position (no re-prompt); `restart` plays
 * from the beginning with no resume offer.
 */
export function resolveMovieStartingChoice(
  choice: MovieStartingChoice,
  history: HistoryEntry,
): EpisodeSelection {
  if (choice === "resume") {
    return { season: 1, episode: 1, startAt: history.timestamp, suppressResumePrompt: true };
  }
  return { season: 1, episode: 1, startAt: 0 };
}

/**
 * Movie equivalent of {@link chooseStartingEpisode}. Movies never reached a
 * resume/restart decision (PlaybackPhase started them at 0 unconditionally), so a
 * partially-watched movie silently lost its position. When there is resumable
 * progress, offer Resume/Restart; otherwise play from the beginning with no menu.
 */
export async function chooseMovieStartingPoint(opts: {
  history: HistoryEntry | null;
  container?: Container;
}): Promise<EpisodeSelectionResult> {
  const fromStart: EpisodeSelection = { season: 1, episode: 1, startAt: 0 };
  const history = opts.history;
  if (!history || isFinished(history) || history.timestamp <= 0) {
    return fromStart;
  }

  const resumeAt = formatTimestamp(history.timestamp);
  const picked = await openListShell<MovieStartingChoice>({
    title: "Resume or restart?",
    subtitle: `${history.title} · you stopped at ${resumeAt}`,
    actionContext: createPickerActionContext(
      opts.container,
      "Choose movie starting point",
      opts.container ? [...STARTING_POINT_PICKER_COMMANDS] : undefined,
    ),
    options: [
      {
        value: "resume" as const,
        label: "▶ Resume",
        detail: `Continue from ${resumeAt}`,
      },
      {
        value: "restart" as const,
        label: "↻ Restart",
        detail: "Play from the beginning",
      },
    ],
  });

  if (!picked) return null;
  return resolveMovieStartingChoice(picked, history);
}

const STARTING_POINT_PICKER_COMMANDS = [
  "settings",
  "history",
  "diagnostics",
  "help",
  "about",
  "quit",
  "provider",
] as const;

function createPickerActionContext(
  container: Container | undefined,
  taskLabel: string,
  allowed?: readonly (typeof STARTING_POINT_PICKER_COMMANDS)[number][],
) {
  return container
    ? buildPickerActionContext({
        container,
        taskLabel,
        ...(allowed ? { allowed } : {}),
      })
    : undefined;
}

function describeActiveProvider(container: Container): string {
  const providerId = container.stateManager.getState().provider;
  return container.providerRegistry.get(providerId)?.metadata.name ?? providerId;
}

async function switchProviderFromStartingPicker(
  container: Container,
  scope: { readonly title: TitleInfo; readonly episode: EpisodeInfo },
): Promise<void> {
  const { stateManager, providerRegistry } = container;
  const state = stateManager.getState();
  const fromProviderId = state.provider;
  const picked = await openProviderPicker({
    currentProvider: fromProviderId,
    providers: providerRegistry
      .getAll()
      .map((provider) => provider.metadata)
      .filter((provider) => provider.isAnimeProvider === (state.mode === "anime")),
    actionContext: buildPickerActionContext({
      container,
      taskLabel: "Choose provider",
      allowed: ["settings", "history", "diagnostics", "help", "about", "quit"],
    }),
  });
  if (!picked || picked === fromProviderId) return;

  await applyUserProviderSwitch({
    container,
    fromProviderId,
    toProviderId: picked,
    title: scope.title,
    episode: scope.episode,
    mode: state.mode,
  });
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
    if (!seasons) return null;
    const season = await chooseSeasonFromOptions(
      seasons,
      initSeason,
      createPickerActionContext(opts.container, "Choose season"),
      opts.container,
    );
    if (!season) return null;
    const fetchedEpisodes =
      season === initSeason ? initialEpisodes : await fetchEpisodes(opts.currentId, season);
    const episodes = fetchedEpisodes ?? [];
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

  // Resolve real episode names so each choice says *what* it plays, not just a
  // code. Anime names come from the in-memory list; series names from one
  // (cached) TMDB fetch per season. TMDB stubs unknown titles as "Episode N" —
  // those are dropped so we never show a redundant name.
  const seasonEpisodeCache = new Map<number, readonly TmdbEpisodeInfo[] | null>();
  const loadSeasonEpisodes = async (season: number): Promise<readonly TmdbEpisodeInfo[] | null> => {
    if (seasonEpisodeCache.has(season)) return seasonEpisodeCache.get(season) ?? null;
    const episodes = await fetchEpisodes(opts.currentId, season).catch(() => null);
    seasonEpisodeCache.set(season, episodes);
    return episodes;
  };
  const resolveEpisodeName = async (
    season: number,
    episode: number,
  ): Promise<string | undefined> => {
    const raw = opts.isAnime
      ? opts.animeEpisodes?.find((option) => option.index === episode)?.name
      : (await loadSeasonEpisodes(season))?.find((entry) => entry.number === episode)?.name;
    const name = raw?.trim();
    return name && !/^episode\s+\d+$/i.test(name) ? name : undefined;
  };

  const currentName = finished
    ? undefined
    : await resolveEpisodeName(history.season, history.episode);
  const nextName = nextEpisode
    ? await resolveEpisodeName(nextEpisode.season, nextEpisode.episode)
    : undefined;
  const withName = (base: string, name: string | undefined): string =>
    name ? `${base} · ${name}` : base;

  const startingScope = opts.isAnime ? "episode" : "season and episode";
  const titleForProviderSwitch: TitleInfo = {
    id: opts.currentId,
    name: history.title,
    type: "series",
    ...(opts.animeEpisodeCount !== undefined ? { episodeCount: opts.animeEpisodeCount } : {}),
  };
  const episodeForProviderSwitch: EpisodeInfo = {
    season: opts.isAnime ? 1 : history.season,
    episode: history.episode,
  };
  let choice: StartingEpisodePickerChoice | null = null;

  while (choice === null) {
    const providerName = opts.container ? describeActiveProvider(opts.container) : null;
    const picked = await openListShell<StartingEpisodePickerChoice>({
      title: "Where to start?",
      subtitle: providerName
        ? `${history.title} · ${providerName} · choose the starting ${startingScope}`
        : `${history.title} · choose the starting ${startingScope}`,
      actionContext: createPickerActionContext(
        opts.container,
        "Choose starting point",
        opts.container ? [...STARTING_POINT_PICKER_COMMANDS] : undefined,
      ),
      options: [
        ...(!finished
          ? [
              {
                value: "resume" as const,
                label: `▶ Resume S${history.season}E${history.episode}`,
                detail: withName(`Continue from ${resumeAt}`, currentName),
              },
              {
                value: "restart" as const,
                label: `↻ Restart S${history.season}E${history.episode}`,
                detail: withName("Start the current episode from the beginning", currentName),
              },
            ]
          : []),
        {
          value: "next" as const,
          label: nextEpisode
            ? `⏭ Next episode  S${nextEpisode.season}E${nextEpisode.episode}`
            : "⏭ Next episode unavailable",
          detail: nextEpisode
            ? withName("Advance to the next released episode", nextName)
            : "No later released episode is available yet",
        },
        {
          value: "pick" as const,
          label: opts.isAnime ? "☰ Pick episode…" : "☰ Pick season & episode…",
          detail: "Choose manually from metadata",
        },
        ...(opts.container
          ? [
              {
                value: "switch-provider" as const,
                label: `⇄ Switch provider  ·  ${providerName ?? opts.container.stateManager.getState().provider}`,
                detail: "Saved for this title · overrides history provider on resume",
              },
            ]
          : []),
      ],
    });

    if (!picked) {
      return null;
    }

    if (picked === "switch-provider") {
      if (opts.container) {
        await switchProviderFromStartingPicker(opts.container, {
          title: titleForProviderSwitch,
          episode: episodeForProviderSwitch,
        });
      }
      continue;
    }

    choice = picked;
  }

  const resolvedChoice = resolveStartingEpisodeChoice({
    choice,
    isAnime: opts.isAnime,
    history,
    nextEpisode,
  });
  if (resolvedChoice) return resolvedChoice;

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
  const percent = projectWatchProgress(entry).percentage ?? 0;
  const resumeAt = formatTimestamp(entry.timestamp);
  return isFinished(entry)
    ? `Last finished: ${cyan(`S${entry.season}E${entry.episode}`)}`
    : `Last watched: ${cyan(`S${entry.season}E${entry.episode}`)}  stopped at ${yellow(resumeAt)}  ${dim(`(${percent}%)`)}`;
}
