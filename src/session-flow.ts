import { text, select, isCancel } from "@clack/prompts";

import { type HistoryEntry, formatTimestamp, isFinished } from "@/history";
import { cyan, dim, yellow } from "@/menu";
import { fetchSeriesData } from "@/tmdb";
import { pickEpisodeInteractive, pickWithFzf, pickSeasonInteractive } from "@/ui";
import { ANIME_PROVIDERS, PLAYWRIGHT_PROVIDERS, getProvider } from "@/providers";
import type { ApiSearchResult } from "@/providers";

export type EpisodeSelection = {
  season: number;
  episode: number;
};

type SelectionOpts = {
  currentId: string;
  hasFzf: boolean;
  isAnime: boolean;
  apiPicked: ApiSearchResult | null;
  flags: { season?: string; episode?: string };
  getHistoryEntry: () => Promise<HistoryEntry | null>;
};

function guard<T>(value: T | symbol): T | null {
  return isCancel(value) ? null : (value as T);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

async function pickAnimeEpisode(
  initialEpisode: number,
  apiPicked: ApiSearchResult | null,
  hasFzf: boolean,
): Promise<number> {
  const epCount = apiPicked?.epCount;
  if (!epCount || epCount < 1) {
    const validateEpisode = (value: string | undefined) =>
      /^\d+$/.test((value ?? "").trim()) && Number.parseInt(value ?? "0", 10) >= 1
        ? undefined
        : "Enter a whole number ≥ 1";

    const raw = guard(
      await text({
        message: "Episode:",
        initialValue: String(initialEpisode),
        validate: validateEpisode,
      }),
    );
    return raw ? Number(raw) : initialEpisode;
  }

  const episodes = Array.from({ length: epCount }, (_, index) => index + 1);
  const picked = await pickWithFzf(episodes, (episode) => `Episode ${episode}`, {
    prompt: "Episode",
    hasFzf,
  });
  return picked ?? initialEpisode;
}

async function pickEpisodeSelection(
  initSeason: number,
  initEpisode: number,
  opts: Pick<SelectionOpts, "currentId" | "hasFzf" | "isAnime" | "apiPicked">,
): Promise<EpisodeSelection> {
  if (!opts.isAnime) {
    const season =
      (await pickSeasonInteractive(opts.currentId, initSeason, { hasFzf: opts.hasFzf })) ??
      initSeason;
    const episode = await pickEpisodeInteractive(opts.currentId, season, initEpisode, {
      hasFzf: opts.hasFzf,
    });
    return { season, episode: episode?.number ?? initEpisode };
  }

  const episode = await pickAnimeEpisode(initEpisode, opts.apiPicked, opts.hasFzf);
  return { season: 1, episode };
}

export async function chooseStartingEpisode(opts: SelectionOpts): Promise<EpisodeSelection> {
  if (opts.flags.season || opts.flags.episode) {
    return {
      season: opts.isAnime ? 1 : parsePositiveInt(opts.flags.season, 1),
      episode: parsePositiveInt(opts.flags.episode, 1),
    };
  }

  const warmMetadata = !opts.isAnime
    ? fetchSeriesData(opts.currentId, 1)
        .then(() => {})
        .catch(() => {})
    : Promise.resolve();

  const history = await Promise.all([opts.getHistoryEntry(), warmMetadata]).then(
    ([entry]) => entry,
  );
  if (!history) {
    return pickEpisodeSelection(1, 1, opts);
  }

  const finished = isFinished(history);
  const nextEpisode = history.episode + 1;
  const resumeAt = formatTimestamp(history.timestamp);

  const choice = guard(
    await select({
      message: "Where to start?",
      options: [
        ...(!finished
          ? [
              {
                value: "resume",
                label: `Resume S${history.season}E${history.episode} from ${resumeAt}`,
              },
              {
                value: "restart",
                label: `Restart S${history.season}E${history.episode} from the beginning`,
              },
            ]
          : []),
        { value: "next", label: `Next episode  S${history.season}E${nextEpisode}` },
        { value: "pick", label: opts.isAnime ? "Pick episode…" : "Pick season & episode…" },
      ],
      initialValue: finished ? "next" : "resume",
    }),
  ) as "resume" | "restart" | "next" | "pick" | null;

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
