import type { ShellPickerOption } from "@/app-shell/types";
import type { EpisodeInfo, EpisodePickerOption, TitleInfo } from "@/domain/types";
import {
  formatTimestamp,
  isFinished,
  type HistoryEntry,
} from "@/services/persistence/HistoryStore";
import { fetchEpisodes } from "@/tmdb";

export type PlaybackEpisodePickerInput = {
  title: TitleInfo;
  currentEpisode: EpisodeInfo;
  isAnime: boolean;
  animeEpisodeCount?: number;
  animeEpisodes?: readonly EpisodePickerOption[];
  watchedEntries?: readonly HistoryEntry[];
  loadEpisodes?: typeof fetchEpisodes;
};

export type PlaybackEpisodePickerOptions = {
  options: readonly ShellPickerOption<string>[];
  subtitle: string;
};

export async function buildPlaybackEpisodePickerOptions({
  title,
  currentEpisode,
  isAnime,
  animeEpisodeCount,
  animeEpisodes,
  watchedEntries = [],
  loadEpisodes = fetchEpisodes,
}: PlaybackEpisodePickerInput): Promise<PlaybackEpisodePickerOptions> {
  const watchedByEpisode = new Map(
    watchedEntries.map((entry) => [`${entry.season}:${entry.episode}`, entry] as const),
  );

  if (title.type !== "series") {
    return {
      options: [],
      subtitle: "Episode picker is only available for episodic playback",
    };
  }

  if (isAnime) {
    if (animeEpisodes && animeEpisodes.length > 0) {
      return {
        subtitle: `${animeEpisodes.length} released episodes available`,
        options: animeEpisodes.map((entry) => ({
          value: `${1}:${entry.index}`,
          label:
            entry.index === currentEpisode.episode ? `${entry.label}  ·  current` : entry.label,
          detail: mergeEpisodeDetail(
            watchedByEpisode.get(`1:${entry.index}`),
            entry.detail,
          ),
        })),
      };
    }

    const fallbackCount = Math.max(
      animeEpisodeCount ?? title.episodeCount ?? 0,
      currentEpisode.episode,
    );
    return {
      subtitle: `${fallbackCount} episode slots available`,
      options: Array.from({ length: fallbackCount }, (_, index) => index + 1).map((episode) => ({
        value: `${1}:${episode}`,
        label:
          episode === currentEpisode.episode
            ? `Episode ${episode}  ·  current`
            : `Episode ${episode}`,
        detail: mergeEpisodeDetail(watchedByEpisode.get(`1:${episode}`)),
      })),
    };
  }

  const episodes = await loadEpisodes(title.id, currentEpisode.season);
  return {
    subtitle: `Season ${currentEpisode.season}  ·  ${episodes.length} episodes`,
    options: episodes.map((entry) => ({
      value: `${currentEpisode.season}:${entry.number}`,
      label:
        entry.number === currentEpisode.episode
          ? `Episode ${entry.number}  ·  ${entry.name}  ·  current`
          : `Episode ${entry.number}  ·  ${entry.name}`,
      detail: mergeEpisodeDetail(
        watchedByEpisode.get(`${currentEpisode.season}:${entry.number}`),
        `${entry.airDate || "unknown year"}${entry.overview ? `  ·  ${entry.overview}` : ""}`,
      ),
    })),
  };
}

function mergeEpisodeDetail(entry?: HistoryEntry, baseDetail?: string): string | undefined {
  const watchedDetail = describeWatchDetail(entry);
  if (watchedDetail && baseDetail) return `${watchedDetail}  ·  ${baseDetail}`;
  return watchedDetail ?? baseDetail;
}

function describeWatchDetail(entry: HistoryEntry | undefined): string | undefined {
  if (!entry) return undefined;
  if (isFinished(entry)) return "watched";
  return `resume ${formatTimestamp(entry.timestamp)}`;
}
